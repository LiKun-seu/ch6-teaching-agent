# -*- coding: utf-8 -*-
"""7个基础输入+4个物理组合；只读取基础输入，不读取标签或复核结果列。"""
from .RC_Beam_Code_Parameters import ALPHA1
BASE_FEATURES = ["b_mm","h_mm","h0_mm","fc_MPa","ft_MPa","fy_MPa","M_design_kNm"]
PHYSICAL_FEATURES = ["moment_strength_ratio","steel_area_scale_mm2","gross_section_area_mm2","ft_fy_ratio"]
FEATURES = BASE_FEATURES + PHYSICAL_FEATURES
FEATURE_LABELS = ["截面宽度 b","截面总高度 h","有效高度 h0","混凝土抗压设计值 fc",
                  "混凝土抗拉设计值 ft","钢筋抗拉设计值 fy","设计弯矩 M",
                  "弯矩强度比 M/(fc·b·h0²)","抗弯面积尺度 fc·b·h0/fy",
                  "毛截面面积 b·h","强度比 ft/fy"]
TARGET = "As_required_mm2"
MODEL_KIND = "catboost_required_area_assumed_single_normalized_target_v2"
ALL_LABELS = dict(zip(FEATURES, FEATURE_LABELS))
FEATURE_DEFINITIONS = {
    "moment_strength_ratio": {"formula":"M_design_kNm*1e6/(alpha1*fc_MPa*b_mm*h0_mm**2)",
                              "unit":"无量纲","meaning":"弯矩需求相对于给定截面抗弯强度尺度的大小"},
    "steel_area_scale_mm2": {"formula":"alpha1*fc_MPa*b_mm*h0_mm/fy_MPa",
                            "unit":"mm²","meaning":"将相对受压区高度换算为钢筋面积的尺度，不是所需面积"},
    "gross_section_area_mm2": {"formula":"b_mm*h_mm","unit":"mm²",
                               "meaning":"最小配筋面积计算的截面面积尺度"},
    "ft_fy_ratio": {"formula":"ft_MPa/fy_MPa","unit":"无量纲",
                    "meaning":"最小配筋率中材料强度比的基础项"},
}


def feature_names(physical=True):
    if not isinstance(physical, bool):
        raise ValueError("物理特征开关须为布尔值")
    return list(FEATURES if physical else BASE_FEATURES)


def feature_frame(frame, physical=True):
    import numpy as np
    # 即使表中已有同名组合列，也从7个基础输入重新计算，防止读取过期结果。
    features=frame.loc[:,BASE_FEATURES].astype(float).copy()
    if not np.isfinite(features.to_numpy()).all():
        raise ValueError("模型基础输入包含非有限值")
    positive=BASE_FEATURES[:-1]
    if (features[positive]<=0).any().any() or (features.M_design_kNm<0).any():
        raise ValueError("尺寸及材料强度须为正，设计弯矩须非负")
    if (features.h0_mm>=features.h_mm).any():
        raise ValueError("有效高度须小于截面总高度")
    b,h,h0=features.b_mm,features.h_mm,features.h0_mm
    fc,ft,fy=features.fc_MPa,features.ft_MPa,features.fy_MPa
    features["moment_strength_ratio"]=features.M_design_kNm*1e6/(ALPHA1*fc*b*h0**2)
    features["steel_area_scale_mm2"]=ALPHA1*fc*b*h0/fy
    features["gross_section_area_mm2"]=b*h
    features["ft_fy_ratio"]=ft/fy
    features=features.loc[:,feature_names(physical)]
    if not np.isfinite(features.to_numpy()).all():
        raise ValueError("物理组合特征包含非有限值")
    return features


def area_scale(frame):
    """仅由已知基础输入重算S_A，不读取参考面积、最小面积或缓存组合。"""
    return feature_frame(frame)["steel_area_scale_mm2"].to_numpy(dtype=float)


def target_values(frame, transform):
    import numpy as np
    if transform not in ("identity", "area_scale"):
        raise ValueError("未知面积目标变换")
    values=frame[TARGET].to_numpy(dtype=float)
    if not np.isfinite(values).all() or (values<=0).any():
        raise ValueError("参考面积须为正有限数值")
    return values/area_scale(frame) if transform=="area_scale" else values


def restore_area(raw_prediction,frame,transform):
    """唯一逆变换：预测q乘输入尺度还原面积；不代公式，不做上下限夹紧。"""
    import numpy as np
    if transform not in ("identity","area_scale"):
        raise ValueError("未知面积目标变换")
    values=np.asarray(raw_prediction,dtype=float)
    if values.ndim!=1 or len(values)!=len(frame) or not np.isfinite(values).all():
        raise ValueError("模型原始输出须为等长有限一维数组")
    result=values*area_scale(frame) if transform=="area_scale" else values
    if not np.isfinite(result).all():raise ValueError("恢复面积包含非有限值")
    return result


def predict_frame(model,frame,info):
    # 只读旧基线快照没有transform字段，其模型直接输出面积。
    return restore_area(model.predict(feature_frame(frame,info.get("physical_features_enabled",True))),
                        frame,info.get("target_transform","identity"))
