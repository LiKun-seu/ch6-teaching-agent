"""固定模型发布包的完整性、元数据与特征契约检查。"""
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path

from catboost import CatBoostClassifier, CatBoostRegressor

from .vendor.area import RC_Beam_Area_Features as area_features
from .vendor.review import RC_Beam_Review_Features as review_features
from .vendor.classify_a import RC_Beam_Classify_Features as a_features
from .vendor.classify_b import RC_Beam_Classify_Features as b_features

FEATURE_MODULES = {
    "area": area_features, "review": review_features,
    "classify_a": a_features, "classify_b": b_features,
}
PINNED_HASHES = {
    "area": "5742f93a0835bd973c39057f18ebd1c9a9bf2ff44d0a13a6fd0477b8af20cf0f",
    "review": "5b3372955ef579d224f2975acffcb6fcebeb1e28736ddd063d331eef557d02e8",
    "classify_a": "27226470156a02b7b5068a59b1fbea9c966f31c6fb53b64385d9638709c17f7b",
    "classify_b": "21fb0f177d0c6c1966c21c33fdde98b8b0c540681bd09018e2b1ea7d90ebd66c",
}
PINNED_METADATA_HASHES = {
    "area": "ad6f6b83dc575b8bb90f1785188e05f3d5535ab73d4ffb1eac7cd6af56248564",
    "review": "e838e5c40e089d7df600123c1ea7aa122f641b6650e3b2463b35c4df9a48a144",
    "classify_a": "15ef4a6f458acb4923a6f29311bebf394a06ff617a1d54c10e5bab287ab6b7cf",
    "classify_b": "5d0f25a97e014b1966137ccc1955d17ac785fe7c60516088f7317ba91b0d6feb",
}
DEFAULT_MODELS = Path(__file__).resolve().parent.parent / "models"


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


@dataclass(frozen=True)
class ModelBundle:
    key: str
    model: object
    info: dict
    specification: dict
    features: object


class Registry:
    def __init__(self, root=DEFAULT_MODELS):
        self.root = Path(root).resolve()
        self.manifest = json.loads((self.root / "manifest.json").read_text(encoding="utf-8"))
        if self.manifest.get("schema_version") != 1:
            raise ValueError("模型清单版本不支持")
        if set(self.manifest.get("models", {})) != set(FEATURE_MODULES):
            raise ValueError("模型清单必须包含且仅包含四个正式模型")
        self.bundles = {}
        for key, spec in self.manifest["models"].items():
            self.bundles[key] = self._load(key, spec)
        if sum(b.specification["bytes"] for b in self.bundles.values()) != 3296008:
            raise ValueError("正式模型总大小不匹配")

    def _file(self, relative):
        path = (self.root / relative).resolve()
        if not path.is_relative_to(self.root):
            raise ValueError("模型文件路径必须位于发布包 models 内")
        return path

    def _load(self, key, spec):
        path = self._file(spec["file"])
        info_path = self._file(spec["metadata_file"])
        if spec["sha256"] != PINNED_HASHES[key]:
            raise ValueError(f"{key} 清单哈希不匹配固定发布版本")
        if path.stat().st_size != spec["bytes"] or sha256(path) != spec["sha256"]:
            raise ValueError(f"{key} 模型 SHA256 或大小校验失败")
        if (spec["metadata_sha256"] != PINNED_METADATA_HASHES[key]
                or sha256(info_path) != spec["metadata_sha256"]):
            raise ValueError(f"{key} 元数据 SHA256 校验失败")
        info = json.loads(info_path.read_text(encoding="utf-8"))
        if info.get("qa_only") is not False:
            raise ValueError(f"{key} 不是正式模型")
        for field in ("run_id", "model_kind", "candidate_id", "features", "tree_count", "target_transform"):
            if info.get(field) != spec.get(field):
                raise ValueError(f"{key} 元数据字段不匹配：{field}")
        if info.get("physical_features_enabled") is not True:
            raise ValueError(f"{key} 须使用正式物理特征")
        module = FEATURE_MODULES[key]
        if module.feature_names(True) != spec["features"]:
            raise ValueError(f"{key} 纯推理模块特征顺序不匹配")
        for field in ("training_feature_min", "training_feature_max"):
            if set(info.get(field, {})) != set(spec["features"]):
                raise ValueError(f"{key} 训练特征范围字段不完整")
        model = CatBoostClassifier() if key.startswith("classify_") else CatBoostRegressor()
        model.load_model(str(path))
        if list(model.feature_names_) != spec["features"] or model.tree_count_ != spec["tree_count"]:
            raise ValueError(f"{key} 模型内特征或树数不匹配")
        metadata = model.get_metadata()
        for field in ("run_id", "model_kind", "candidate_id"):
            if metadata.get(field) != spec[field]:
                raise ValueError(f"{key} 模型内元数据不匹配：{field}")
        if key.startswith("classify_"):
            if (info["class_names"] != ["少筋", "适筋", "超筋"]
                    or info["class_names"] != spec["class_names"]
                    or list(model.classes_) != spec["class_ids"]
                    or spec["class_ids"] != [0, 1, 2]
                    or metadata.get("task") != spec["task"]
                    or module.TASK != spec["task"]):
                raise ValueError(f"{key} 类别顺序或 A/B 配置不匹配")
        elif info["target_transform"] != {"area": "area_scale", "review": "capacity_scale"}[key]:
            raise ValueError(f"{key} 目标逆变换不匹配")
        return ModelBundle(key, model, info, spec, module)

    def public_manifest(self):
        return self.manifest

    def versions(self):
        return {key: f"{b.info['run_id']}:{b.info['candidate_id']}" for key, b in self.bundles.items()}
