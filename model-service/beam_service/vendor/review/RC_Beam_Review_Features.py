# -*- coding: utf-8 -*-
"""从5个已知输入现算两个物理组合；不读取参考Mu或缓存答案列。"""
from .RC_Beam_Code_Parameters import ALPHA1
BASE_FEATURES = ["b_mm", "h0_mm", "fc_MPa", "fy_MPa", "As_given_mm2"]
BASE_LABELS = ["截面宽度 b", "有效高度 h0", "混凝土抗压设计值 fc", "钢筋抗拉设计值 fy", "给定受拉钢筋面积 As"]
PHYSICAL_FEATURES = ["reinforcement_xi", "capacity_scale_kNm"]
PHYSICAL_LABELS = ["配筋尺度 fy·As/(α₁·fc·b·h0)", "承载力尺度 α₁·fc·b·h0²/10⁶"]
FEATURES = BASE_FEATURES
FEATURE_LABELS = BASE_LABELS
ALL_LABELS = dict(zip(BASE_FEATURES + PHYSICAL_FEATURES, BASE_LABELS + PHYSICAL_LABELS))
FEATURE_DEFINITIONS = {
    "reinforcement_xi": "fy_MPa*As_given_mm2/(alpha1*fc_MPa*b_mm*h0_mm)",
    "capacity_scale_kNm": "alpha1*fc_MPa*b_mm*h0_mm**2/1e6"
}
TARGET = "Mu_reference_kNm"
MODEL_KIND = "catboost_section_Mu_normalized_target_v4"
TARGET_TRANSFORMS = ("identity", "capacity_scale")


def feature_names(physical=False):
    if not isinstance(physical, bool):
        raise ValueError("物理特征开关须为布尔值")
    return BASE_FEATURES + PHYSICAL_FEATURES if physical else list(BASE_FEATURES)


def feature_frame(frame, physical=False):
    import numpy as np
    result = frame.loc[:, BASE_FEATURES].astype(float).copy()
    if not np.isfinite(result.to_numpy()).all() or (result <= 0).any().any():
        raise ValueError("5项基础输入须为正有限数值")
    if physical:
        result["reinforcement_xi"] = result.fy_MPa * result.As_given_mm2 / (ALPHA1 * result.fc_MPa * result.b_mm * result.h0_mm)
        result["capacity_scale_kNm"] = ALPHA1 * result.fc_MPa * result.b_mm * result.h0_mm**2 / 1e6
    result = result.loc[:, feature_names(physical)]
    if not np.isfinite(result.to_numpy()).all():
        raise ValueError("物理组合存在非有限值")
    return result


def capacity_scale(frame):
    """只从已知基础输入重算S；不使用数据库中缓存的S或Mu。"""
    return feature_frame(frame, True)["capacity_scale_kNm"].to_numpy(dtype=float)


def target_values(frame, transform):
    import numpy as np
    if transform not in TARGET_TRANSFORMS:
        raise ValueError("未知目标变换")
    values = frame[TARGET].to_numpy(dtype=float)
    if not np.isfinite(values).all() or (values <= 0).any():
        raise ValueError("参考Mu须为正有限值")
    return values / capacity_scale(frame) if transform == "capacity_scale" else values


def restore_mu(raw_prediction, frame, transform):
    """唯一的目标逆变换：恢复模型输出的单位，不代入规范公式修正预测。"""
    import numpy as np
    if transform not in TARGET_TRANSFORMS:
        raise ValueError("未知目标变换")
    values = np.asarray(raw_prediction, dtype=float)
    if values.ndim != 1 or len(values) != len(frame) or not np.isfinite(values).all():
        raise ValueError("模型原始输出须为等长有限一维数组")
    result = values * capacity_scale(frame) if transform == "capacity_scale" else values
    if not np.isfinite(result).all():
        raise ValueError("还原Mu存在非有限值")
    return result


def predict_frame(model, frame, info):
    """Train/Predict/Compare/扫描统一使用；旧基线缺目标变换字段时为直接Mu。"""
    return restore_mu(model.predict(feature_frame(frame, info["physical_features_enabled"])),
                      frame, info.get("target_transform", "identity"))
