import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from beam_service.app import create_app
from beam_service.registry import DEFAULT_MODELS, Registry

DESIGN = {"b_mm": 250, "h_mm": 500, "concrete": "C30", "steel": "HRB400", "M_design_kNm": 175}
REVIEW = {"b_mm": 200, "h_mm": 450, "h0_mm": 414, "concrete": "C30", "steel": "HRB400", "As_provided_mm2": 603}


class InterfaceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = TestClient(create_app())
        cls.client = cls.context.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.context.__exit__(None, None, None)

    def post(self, task, payload):
        response = self.client.post(f"/v1/{task}", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_health_and_manifest(self):
        health = self.client.get("/health").json()
        self.assertEqual(health["models_loaded"], 4)
        manifest = self.client.get("/v1/manifest").json()
        self.assertEqual(sum(m["bytes"] for m in manifest["models"].values()), 3296008)
        self.assertEqual(len(health["model_versions"]), 4)

    def test_area_golden_and_geometry(self):
        result = self.post("design", DESIGN)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["geometry"]["h0_mm"], 462)
        self.assertEqual(result["prediction"]["unit"], "mm²")
        self.assertAlmostEqual(result["prediction"]["value"], 1215.3500269576261, places=8)
        self.assertAlmostEqual(result["reference"]["As_required_mm2"], 1212.3763321195704, places=8)
        self.assertAlmostEqual(result["comparison"]["model_minus_reference"],
                               result["prediction"]["value"] - result["reference"]["As_required_mm2"])
        explicit = self.post("design", dict(DESIGN, h0_mm=462))
        self.assertEqual(explicit["prediction"], result["prediction"])
        self.assertEqual(explicit["geometry"]["basis"], "provided_effective_height")

    def test_mu_golden_and_demand_does_not_change_mu(self):
        result = self.post("review", REVIEW)
        self.assertAlmostEqual(result["prediction"]["value"], 82.25017067719503, places=8)
        self.assertEqual(result["prediction"]["unit"], "kN·m")
        disagree = self.post("review", dict(REVIEW, M_design_kNm=82))
        self.assertEqual(disagree["prediction"], result["prediction"])
        self.assertTrue(disagree["comparison"]["model_meets"])
        self.assertFalse(disagree["comparison"]["reference_meets"])
        self.assertTrue(disagree["comparison"]["decision_disagrees"])

    def test_a_b_semantics_and_three_classes(self):
        base = {"b_mm": 300, "h_mm": 600, "h0_mm": 550, "concrete": "C30", "steel": "HRB400"}
        for moment, area, name in ((10, 300, "少筋"), (250, 1200, "适筋"), (550, 3800, "超筋")):
            a = self.post("design", dict(base, M_design_kNm=moment))
            b = self.post("review", dict(base, As_provided_mm2=area))
            self.assertEqual(a["classification"]["class_name"], name)
            self.assertEqual(b["classification"]["class_name"], name)
            self.assertNotEqual(a["classification"]["label"], b["classification"]["label"])
            self.assertEqual(list(a["classification"]["probabilities"]), ["少筋", "适筋", "超筋"])
            self.assertAlmostEqual(sum(a["classification"]["probabilities"].values()), 1)
        self.assertIsNone(a["prediction"])
        self.assertIsNone(b["prediction"])

    def test_out_of_range_regression_is_not_called(self):
        service = self.client.app.state.service
        with patch.object(service, "_predict", side_effect=AssertionError("回归不应执行")):
            result = self.post("design", dict(DESIGN, M_design_kNm=1000))
            self.assertEqual(result["status"], "needs_redesign")
            for area, status in ((0, "below_minimum_reinforcement"), (9000, "beyond_single_reinforced_method")):
                result = self.post("review", dict(REVIEW, As_provided_mm2=area))
                self.assertEqual(result["status"], status)
                self.assertIsNone(result["prediction"])
                self.assertIsNone(result["comparison"])

    def test_classifier_does_not_gate_regression(self):
        service = self.client.app.state.service
        with patch.object(service, "_classify", return_value=({"class_name": "超筋", "label": "测试", "probabilities": {"少筋": 0, "适筋": 0, "超筋": 1}}, [])):
            result = self.post("design", DESIGN)
            self.assertEqual(result["status"], "ok")
            self.assertIsNotNone(result["prediction"])

    def test_exact_minimum_and_single_reinforced_boundaries(self):
        normal = self.post("review", REVIEW)
        low = normal["reference"]["As_min_mm2"]
        high = normal["reference"]["As_yield_limit_mm2"]
        self.assertEqual(self.post("review", dict(REVIEW, As_provided_mm2=low))["status"], "ok")
        self.assertEqual(self.post("review", dict(REVIEW, As_provided_mm2=high))["status"], "ok")
        self.assertEqual(self.post("review", dict(REVIEW, As_provided_mm2=low * 0.999))["status"], "below_minimum_reinforcement")
        self.assertEqual(self.post("review", dict(REVIEW, As_provided_mm2=high * 1.001))["status"], "beyond_single_reinforced_method")
        normal = self.post("design", DESIGN)
        limit = normal["reference"]["M_limit_kNm"]
        self.assertEqual(self.post("design", dict(DESIGN, M_design_kNm=limit))["status"], "ok")
        self.assertEqual(self.post("design", dict(DESIGN, M_design_kNm=limit * 1.001))["status"], "needs_redesign")

    def test_zero_moment_is_minimum_control(self):
        result = self.post("design", dict(DESIGN, M_design_kNm=0))
        self.assertEqual(result["reference"]["control"], "minimum_reinforcement")
        self.assertIsNotNone(result["prediction"])
        self.assertTrue(any("超出训练记录范围" in x for x in result["warnings"]))

    def test_unlisted_diameters_match_original_prediction_entry(self):
        result = self.post("design", dict(DESIGN, stirrup_d_mm=12, assumed_longitudinal_d_mm=21))
        self.assertEqual(result["geometry"]["h0_mm"], 457.5)
        self.assertIsNotNone(result["prediction"])
        self.assertTrue(any("采样设置" in x for x in result["warnings"]))

    def test_provided_h0_ignores_assumed_geometry_options(self):
        result = self.post("design", dict(DESIGN, h0_mm=462, environment_class="IIIb",
                                          design_life_years=120, stirrup_d_mm=0,
                                          assumed_longitudinal_d_mm=0))
        self.assertAlmostEqual(result["prediction"]["value"], 1215.3500269576261, places=8)
        self.assertEqual(result["geometry"]["basis"], "provided_effective_height")

    def test_minimum_area_must_fit_single_reinforced_limit(self):
        service = self.client.app.state.service
        with patch.object(service, "_predict", side_effect=AssertionError("冲突范围不得回归")):
            result = self.post("design", dict(DESIGN, h0_mm=10, M_design_kNm=0))
        self.assertEqual(result["status"], "needs_redesign")
        self.assertIsNone(result["prediction"])
        self.assertIsNone(result["comparison"])
        self.assertEqual(result["reference"]["As_required_mm2"], 250)
        self.assertEqual(result["reference"]["consistency_check"]["capacity_status"], "beyond_single_reinforced_method")
        self.assertIsNotNone(result["classification"])

    def test_strict_invalid_inputs(self):
        invalid = [
            ("design", dict(DESIGN, b_mm=True)), ("design", dict(DESIGN, M_design_kNm="175")),
            ("design", dict(DESIGN, unexpected=1)), ("design", dict(DESIGN, concrete="C50")),
            ("design", dict(DESIGN, steel="HRB335")), ("design", dict(DESIGN, h_mm=850)),
            ("design", dict(DESIGN, b_mm=400)), ("design", dict(DESIGN, M_design_kNm=-1)),
            ("design", dict(DESIGN, h0_mm=500)), ("design", dict(DESIGN, design_life_years=True)),
            ("design", dict(DESIGN, environment_class="IIa", design_life_years=100)),
            ("design", dict(DESIGN, environment_class="IIIb", concrete="C30")),
            ("design", dict(DESIGN, stirrup_d_mm=0)), ("design", dict(DESIGN, M_design_kNm=1e308)),
            ("design", dict(DESIGN, h0_mm=1e-300)), ("review", dict(REVIEW, h0_mm=0)),
            ("review", dict(REVIEW, h0_mm=1e-300)), ("review", dict(REVIEW, As_provided_mm2=-1)),
            ("review", dict(REVIEW, As_provided_mm2=1e308)),
        ]
        for task, payload in invalid:
            with self.subTest(task=task, payload=payload):
                response = self.client.post(f"/v1/{task}", json=payload)
                self.assertEqual(response.status_code, 422, response.text)
                self.assertIn("detail", response.json())

    def test_nonfinite_raw_json_and_invalid_bodies(self):
        for token in ("NaN", "Infinity", "-Infinity", "1e999"):
            body = json.dumps(DESIGN).replace('175', token)
            response = self.client.post("/v1/design", content=body, headers={"content-type": "application/json"})
            self.assertEqual(response.status_code, 422, response.text)
        for body in ('{"b_mm":', '[]', 'null', '"文字"'):
            response = self.client.post("/v1/design", content=body, headers={"content-type": "application/json"})
            self.assertEqual(response.status_code, 422, response.text)

    def test_models_are_reused_during_lifespan(self):
        first = self.client.app.state.registry
        self.post("design", DESIGN)
        self.post("review", REVIEW)
        self.assertIs(self.client.app.state.registry, first)


class IntegrityTests(unittest.TestCase):
    def mutated_release(self, mutate):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as directory:
            dest = Path(directory) / "models"
            shutil.copytree(DEFAULT_MODELS, dest)
            mutate(dest)
            with self.assertRaises((ValueError, KeyError)):
                Registry(dest)

    def test_bad_manifest_hash_is_rejected(self):
        def mutate(dest):
            path = dest / "manifest.json"
            data = json.loads(path.read_text(encoding="utf-8"))
            data["models"]["area"]["sha256"] = "0" * 64
            path.write_text(json.dumps(data), encoding="utf-8")
        self.mutated_release(mutate)

    def test_bad_model_and_bad_metadata_are_rejected(self):
        for file in ("area/area_model.cbm", "review/model_info.json"):
            def mutate(dest):
                path = dest / file
                path.write_bytes(path.read_bytes() + b" ")
            self.mutated_release(mutate)

    def test_bad_feature_order_and_class_order_rejected(self):
        for field, key in (("features", "area"), ("class_ids", "classify_a")):
            def mutate(dest):
                path = dest / "manifest.json"
                data = json.loads(path.read_text(encoding="utf-8"))
                data["models"][key][field].reverse()
                path.write_text(json.dumps(data), encoding="utf-8")
            self.mutated_release(mutate)

    def test_metadata_and_manifest_cannot_override_fixed_release(self):
        def mutate(dest):
            info_path = dest / "area" / "model_info.json"
            info = json.loads(info_path.read_text(encoding="utf-8"))
            info["target_transform"] = "identity"
            info_path.write_text(json.dumps(info), encoding="utf-8")
            manifest_path = dest / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["models"]["area"]["metadata_sha256"] = hashlib.sha256(info_path.read_bytes()).hexdigest()
            manifest["models"]["area"]["target_transform"] = "identity"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        self.mutated_release(mutate)


if __name__ == "__main__":
    unittest.main()
