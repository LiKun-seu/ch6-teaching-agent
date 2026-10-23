# -*- coding: utf-8 -*-
"""只从7个基础输入现算物理组合；忽略结果列和预存组合值。"""
from .RC_Beam_Classify_Core import TASK,FEATURES as BASE_FEATURES,FEATURE_LABELS as BASE_LABELS,feature_frame as base_frame
from .RC_Beam_Code_Parameters import ALPHA1
PHYSICAL_FEATURES=(["moment_strength_ratio","moment_reinforcement_scale_ratio","ft_fy_ratio"] if TASK=="A" else ["yield_assumed_xi","rho_provided_gross","ft_fy_ratio"])
PHYSICAL_LABELS=(["弯矩强度比 M/(fc·b·h0²)","配筋需求尺度 M/(fy·b·h·h0)","材料强度比 ft/fy"] if TASK=="A" else ["受压区尺度 fy·As/(fc·b·h0)","实配配筋率 As/(b·h)","材料强度比 ft/fy"])
ALL_LABELS=dict(zip(BASE_FEATURES+PHYSICAL_FEATURES,BASE_LABELS+PHYSICAL_LABELS))
FEATURE_DEFINITIONS=({"moment_strength_ratio":"M_design_kNm*1e6/(alpha1*fc_MPa*b_mm*h0_mm**2)","moment_reinforcement_scale_ratio":"M_design_kNm*1e6/(fy_MPa*b_mm*h_mm*h0_mm)","ft_fy_ratio":"ft_MPa/fy_MPa"} if TASK=="A" else {"yield_assumed_xi":"fy_MPa*As_provided_mm2/(alpha1*fc_MPa*b_mm*h0_mm)","rho_provided_gross":"As_provided_mm2/(b_mm*h_mm)","ft_fy_ratio":"ft_MPa/fy_MPa"})


def feature_names(physical):
    if not isinstance(physical,bool): raise ValueError("物理特征开关须为布尔值")
    return BASE_FEATURES+PHYSICAL_FEATURES if physical else list(BASE_FEATURES)


def feature_frame(frame,physical=False):
    import numpy as np
    x=base_frame(frame)
    if physical:
        b,h,h0,fc,ft,fy=(x[c] for c in BASE_FEATURES[:6])
        if TASK=="A":
            x["moment_strength_ratio"]=x.M_design_kNm*1e6/(ALPHA1*fc*b*h0**2)
            x["moment_reinforcement_scale_ratio"]=x.M_design_kNm*1e6/(fy*b*h*h0)
        else:
            x["yield_assumed_xi"]=fy*x.As_provided_mm2/(ALPHA1*fc*b*h0)
            x["rho_provided_gross"]=x.As_provided_mm2/(b*h)
        x["ft_fy_ratio"]=ft/fy
    x=x.loc[:,feature_names(physical)]
    if not np.isfinite(x.to_numpy()).all(): raise ValueError("组合特征包含非有限值")
    return x
