"""两个教学任务；规则先检查，分类器只展示，回归只对可算参考生成。"""
import math

import numpy as np
import pandas as pd

from .schemas import DesignRequest, ReviewRequest
from .vendor.area.RC_Beam_Area_Design import design_area
from .vendor.area.RC_Beam_Assumed_Geometry import assumed_geometry
from .vendor.area.RC_Beam_Code_Parameters import CONCRETE, STEEL
from .vendor.review.RC_Beam_Review_Core import review_section

SCOPE = ("普通非抗震、非预应力矩形单筋截面，不计受压钢筋贡献；"
         "C30/C35/C40、HRB400/HRB500；设计弯矩已包含应计入的结构重要性系数。"
         "模型与公式对照用于教学，不包含实际选筋、布置及完整梁设计。")
MODEL_LABELS = {"area": "配筋面积模型", "review": "承载力模型",
                "classify_a": "设计状态分类模型", "classify_b": "实配状态分类模型"}


def require_finite(value):
    """防止上溢、下溢造成无效结果流到 JSON；不把非有限值转成 null。"""
    if isinstance(value, dict):
        for item in value.values():
            require_finite(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            require_finite(item)
    elif isinstance(value, (float, np.floating)) and not math.isfinite(value):
        raise ValueError("输入数量级超出当前计算支持范围，请检查单位和有效高度")


class BeamService:
    def __init__(self, registry):
        self.registry = registry

    def _frame(self, request, h0):
        data = request.model_dump()
        data.update(h0_mm=h0, **CONCRETE[request.concrete], **STEEL[request.steel])
        if isinstance(request, ReviewRequest):
            data["As_given_mm2"] = request.As_provided_mm2
        return pd.DataFrame([data])

    @staticmethod
    def _range_warnings(bundle, features):
        row = features.iloc[0]
        warnings = []
        for field in bundle.info["features"]:
            value = float(row[field])
            low = bundle.info["training_feature_min"][field]
            high = bundle.info["training_feature_max"][field]
            if value < low or value > high:
                label = bundle.features.ALL_LABELS.get(field, field)
                warnings.append(f"{MODEL_LABELS[bundle.key]}：{label}={value:.6g} 超出训练记录范围 [{low:.6g}, {high:.6g}]。")
        return warnings

    @staticmethod
    def _check_model_numbers(features):
        values = features.to_numpy(dtype=float)
        absolute = np.abs(values)
        if ((absolute > np.finfo(np.float32).max).any()
                or ((absolute > 0) & (absolute < np.nextafter(np.float32(0), np.float32(1)))).any()):
            raise ValueError("输入计算出的特征数量级超出模型数值表示范围，请检查单位和有效高度")

    def _classify(self, key, frame, reference_class_id):
        bundle = self.registry.bundles[key]
        features = bundle.features.feature_frame(frame, True)
        self._check_model_numbers(features)
        probabilities = np.asarray(bundle.model.predict_proba(features), dtype=float)[0]
        class_id = int(np.asarray(bundle.model.predict(features)).reshape(-1)[0])
        if (class_id not in (0, 1, 2) or not np.isfinite(probabilities).all()
                or (probabilities < 0).any() or not np.isclose(probabilities.sum(), 1.0)):
            raise RuntimeError("分类模型输出无效")
        warnings = self._range_warnings(bundle, features)
        if class_id != reference_class_id:
            warnings.append("分类模型与确定性公式参考状态不同，请按公式参考与适用范围理解结果。")
        warnings.append("分类概率为模型原始概率，未经独立概率校准；不代表规范通过概率。")
        classification = {
            "class_name": bundle.info["class_names"][class_id],
            "label": bundle.info["class_semantics"][class_id],
            "probabilities": dict(zip(bundle.info["class_names"], map(float, probabilities))),
        }
        return classification, warnings

    def _predict(self, key, frame, reference_value, moment=None):
        bundle = self.registry.bundles[key]
        features = bundle.features.feature_frame(frame, True)
        self._check_model_numbers(features)
        # 只用原模块 predict_frame；内部按正式元数据进行唯一一次目标逆变换。
        value = float(bundle.features.predict_frame(bundle.model, frame, bundle.info)[0])
        if not math.isfinite(value) or value <= 0:
            raise RuntimeError("回归模型产生非正或非有限输出")
        delta = value - reference_value
        comparison = {
            "model_minus_reference": delta,
            "relative_error_percent": delta / reference_value * 100,
        }
        warnings = self._range_warnings(bundle, features)
        if moment is not None:
            model_meets, reference_meets = value >= moment, reference_value >= moment
            comparison.update(model_meets=model_meets, reference_meets=reference_meets,
                              decision_disagrees=model_meets != reference_meets)
            if model_meets != reference_meets:
                warnings.append("模型预测与公式参考对当前设计弯矩的满足性判断不同，请核对公式参考。")
        return ({"value": value, "unit": "mm²" if key == "area" else "kN·m", "model_key": key},
                comparison, warnings)

    def design(self, request: DesignRequest):
        if request.h0_mm is None:
            assumed = assumed_geometry(request.h_mm, request.concrete, request.environment_class,
                                       request.design_life_years, request.stirrup_d_mm,
                                       request.assumed_longitudinal_d_mm, allow_unlisted_diameters=True)
            geometry = dict(assumed, basis=assumed["h0_basis"])
            warnings = ["h0 按预估单排纵筋位置计算；尚未验证选筋、排数、净距及实际排布。"]
            if (request.design_life_years != 50 or request.assumed_longitudinal_d_mm != 20
                    or request.stirrup_d_mm not in (8, 10)):
                warnings.append("当前预估几何假设与面积模型采样设置（50年、箍筋8/10 mm、纵筋20 mm）不同。")
        else:
            geometry = {"h0_mm": request.h0_mm, "basis": "provided_effective_height",
                        "a_s_given_mm": request.h_mm - request.h0_mm,
                        "placement_status": "provided_not_verified"}
            warnings = ["h0 使用填写值；须与实际受拉钢筋合力位置一致，页面未校验实际布筋。"]
        h0 = geometry["h0_mm"]
        reference = design_area(request.b_mm, request.h_mm, h0, request.concrete,
                                request.steel, request.M_design_kNm)
        if reference["status"] not in ("ok", "needs_redesign"):
            raise ValueError(reference["reason"] or "当前输入无法计算设计参考")
        require_finite(reference)
        status = reference["status"]
        if status == "ok":
            consistency = review_section(request.b_mm, request.h_mm, h0, request.concrete,
                                         request.steel, reference["As_required_mm2"])
            require_finite(consistency)
            if consistency["capacity_status"] == "invalid_input":
                raise ValueError(consistency["reason"])
            if consistency["capacity_status"] != "ok":
                status = "needs_redesign"
                reference["consistency_check"] = {
                    "capacity_status": consistency["capacity_status"],
                    "As_yield_limit_mm2": consistency["As_yield_limit_mm2"],
                    "reason": consistency["reason"],
                }
                warnings.append("公式所需面积（含最小配筋控制）超过当前 h0 下的单筋简式上限；需调整截面、有效高度或另做受力设计，暂停面积回归。")
        reference_class = (2 if reference["status"] == "needs_redesign"
                           else 0 if reference["control"] == "minimum_reinforcement" else 1)
        frame = self._frame(request, h0)
        classification, class_warnings = self._classify("classify_a", frame, reference_class)
        warnings.extend(class_warnings)
        prediction = comparison = None
        if status == "ok":
            prediction, comparison, model_warnings = self._predict("area", frame, reference["As_required_mm2"])
            warnings.extend(model_warnings)
        elif reference["status"] == "needs_redesign":
            warnings.append(reference["reason"])
        result = {"task": "design", "status": status, "inputs": request.model_dump(),
                  "geometry": geometry, "classification": classification, "prediction": prediction,
                  "reference": reference, "comparison": comparison, "warnings": warnings,
                  "model_versions": self.registry.versions(), "scope": SCOPE}
        require_finite(result)
        return result

    def review(self, request: ReviewRequest):
        reference = review_section(request.b_mm, request.h_mm, request.h0_mm, request.concrete,
                                   request.steel, request.As_provided_mm2, request.M_design_kNm)
        status = reference["capacity_status"]
        mapping = {"below_minimum_reinforcement": 0, "ok": 1, "beyond_single_reinforced_method": 2}
        if status not in mapping:
            raise ValueError(reference["reason"] or "当前输入无法计算复核参考")
        require_finite(reference)
        frame = self._frame(request, request.h0_mm)
        classification, warnings = self._classify("classify_b", frame, mapping[status])
        warnings.append("实配配筋状态与承载力满足性分别判断；“适筋”不直接表示满足设计弯矩。")
        prediction = comparison = None
        if status == "ok":
            prediction, comparison, model_warnings = self._predict("review", frame, reference["Mu_reference_kNm"],
                                                                   request.M_design_kNm)
            warnings.extend(model_warnings)
        else:
            warnings.append(reference["reason"])
        result = {"task": "review", "status": status, "inputs": request.model_dump(),
                  "geometry": {"h0_mm": request.h0_mm, "basis": "provided_effective_height",
                               "a_s_given_mm": request.h_mm - request.h0_mm,
                               "placement_status": "provided_not_verified"},
                  "classification": classification, "prediction": prediction, "reference": reference,
                  "comparison": comparison, "warnings": warnings,
                  "model_versions": self.registry.versions(), "scope": SCOPE}
        require_finite(result)
        return result
