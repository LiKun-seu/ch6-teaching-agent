# -*- coding: utf-8 -*-
"""三分类公共定义；A设计状态和B实配状态含义分开保存。"""
import sys
sys.dont_write_bytecode=True
import json,math
from pathlib import Path
import numpy as np
from .RC_Beam_Code_Parameters import METHOD_VERSION
ROOT=Path(__file__).resolve().parent
CONFIG=json.loads((ROOT/"classification_config.json").read_text(encoding="utf-8"))
TASK=CONFIG["task"];FEATURES=CONFIG["features"];CLASS_NAMES=CONFIG["class_names"]
SEMANTICS=CONFIG["class_semantics"];MODEL_KIND=CONFIG["model_kind"];TARGET="class_id"
FEATURE_LABELS=["截面宽度 b","截面高度 h","有效高度 h0","混凝土抗压设计值 fc","混凝土抗拉设计值 ft","钢筋抗拉设计值 fy"]+["设计弯矩 M" if TASK=="A" else "实配钢筋面积 As"]


def feature_frame(frame):
    # 只取7个数值输入；不读status/control、面积答案、Mu、工况编号等审计字段。
    features=frame.loc[:,FEATURES].astype(float).copy()
    if not np.isfinite(features.to_numpy()).all(): raise ValueError("输入包含NaN或无穷大")
    if (features[FEATURES[:6]]<=0).any().any() or (features[FEATURES[6]]<0).any():
        raise ValueError("尺寸/材料强度须为正，弯矩或实配面积须非负")
    if (features.h0_mm>=features.h_mm).any(): raise ValueError("须满足0<h0<h")
    return features


def validate_section(b,h):
    heights=tuple(range(200,801,50))+(900,)
    if h not in heights: raise ValueError("本项目梁高为200~800每50 mm一档，或900 mm")
    widths=(150,200) if h<=300 else tuple(range(math.ceil(h/3/50)*50,math.floor(h/2/50)*50+1,50))
    if b not in widths: raise ValueError(f"h={h:g}时允许梁宽{list(widths)} mm")


def reference_class(values):
    if TASK=="A":
        from .RC_Beam_Area_Design import design_area
        result=design_area(values["b_mm"],values["h_mm"],values["h0_mm"],values["concrete"],values["steel"],values["M_design_kNm"])
        if result["status"]=="needs_redesign": return 2,result
        if result["status"]!="ok": raise ValueError(result["reason"])
        return (0 if result["control"]=="minimum_reinforcement" else 1),result
    from .RC_Beam_Review_Core import review_section
    area=values.get("As_provided_mm2",values.get("As_given_mm2"))
    result=review_section(values["b_mm"],values["h_mm"],values["h0_mm"],values["concrete"],values["steel"],area,values.get("M_design_kNm"))
    mapping={"below_minimum_reinforcement":0,"ok":1,"beyond_single_reinforced_method":2}
    if result["capacity_status"] not in mapping: raise ValueError(result["reason"])
    return mapping[result["capacity_status"]],result
