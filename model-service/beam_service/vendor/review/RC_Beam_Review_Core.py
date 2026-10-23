# -*- coding: utf-8 -*-
"""给定As、h0的普通非抗震矩形单筋截面；生成规范承载力参考标签。"""
import sys
sys.dont_write_bytecode=True
import math
from .RC_Beam_Code_Parameters import (
    CONCRETE,STEEL,ALPHA1,BETA1,EPSILON_CU,RHO_MIN_CONSTANT,RHO_MIN_FT_FACTOR,
    DESIGN_SCOPE,MOMENT_BASIS,METHOD_VERSION,
)

REVIEW_METHOD_VERSION=METHOD_VERSION
RESULT_COLUMNS=["b_mm","h_mm","h0_mm","concrete","steel","fc_MPa","ft_MPa","fy_MPa",
    "Es_MPa","alpha1","beta1","epsilon_cu","As_given_mm2","M_design_kNm","a_s_given_mm",
    "rho_given_gross","rho_min","As_min_mm2","xi_b","x_limit_mm","As_yield_limit_mm2",
    "x_yield_assumed_mm","xi_yield_assumed","Mu_reference_kNm","capacity_status",
    "reference_bending_check","reason","review_method_version","design_scope","moment_basis"]


def validate_project_section(b,h):
    heights=tuple(range(200,801,50))+(900,)
    if h not in heights:
        raise ValueError("项目梁高须为200~800每50 mm一档，或900 mm；不含850")
    widths=(150,200) if h<=300 else tuple(range(math.ceil(h/3/50)*50,math.floor(h/2/50)*50+1,50))
    if b not in widths:
        raise ValueError(f"h={h:g} mm允许的项目梁宽为{list(widths)} mm")


def review_section(b_mm,h_mm,h0_mm,concrete,steel,As_given_mm2,M_design_kNm=None):
    """Mu标签只对当前简式适用且满足最小配筋的方案生成；其余留空。

    M不影响Mu，仅用于需求比较。超出单筋屈服简式范围不等于全部工程方案不可行。
    """
    result=dict.fromkeys(RESULT_COLUMNS)
    result.update(review_method_version=REVIEW_METHOD_VERSION,design_scope=DESIGN_SCOPE,
                  moment_basis=MOMENT_BASIS,capacity_status="invalid_input",reference_bending_check="not_applicable")
    raw=dict(b_mm=b_mm,h_mm=h_mm,h0_mm=h0_mm,As_given_mm2=As_given_mm2)
    if M_design_kNm is not None:
        raw["M_design_kNm"]=M_design_kNm
    try:
        if any(isinstance(v,bool) for v in raw.values()):
            raise ValueError("数值输入不能为布尔值")
        values={k:float(v) for k,v in raw.items()}
        if not all(math.isfinite(v) for v in values.values()):
            raise ValueError("数值输入须有限")
        result.update(values)
        b,h,h0,area=(values[k] for k in ("b_mm","h_mm","h0_mm","As_given_mm2"))
        moment=values.get("M_design_kNm")
        if b<=0 or h<=0 or not 0<h0<h or area<0 or (moment is not None and moment<0):
            raise ValueError("须满足b>0、h>0、0<h0<h、As>=0、M>=0")
        if not isinstance(concrete,str) or not isinstance(steel,str):
            raise ValueError("材料等级须为字符串")
        concrete,steel=concrete.strip().upper(),steel.strip().upper()
        if concrete not in CONCRETE or steel not in STEEL:
            raise ValueError("本版只支持C30/C35/C40与HRB400/HRB500")
        fc,ft=CONCRETE[concrete]["fc_MPa"],CONCRETE[concrete]["ft_MPa"]
        fy,es=STEEL[steel]["fy_MPa"],STEEL[steel]["Es_MPa"]
        xi_b=BETA1/(1+fy/(es*EPSILON_CU))
        rho_min=max(RHO_MIN_CONSTANT,RHO_MIN_FT_FACTOR*ft/fy)
        area_min=rho_min*b*h
        x_limit=xi_b*h0
        area_limit=ALPHA1*fc*b*x_limit/fy
        x=fy*area/(ALPHA1*fc*b)
        if not all(math.isfinite(v) for v in (area_min,area_limit,x)) or area_min<=0 or area_limit<=0:
            raise ValueError("数值数量级超出当前计算支持范围")
        result.update(concrete=concrete,steel=steel,fc_MPa=fc,ft_MPa=ft,fy_MPa=fy,Es_MPa=es,
            alpha1=ALPHA1,beta1=BETA1,epsilon_cu=EPSILON_CU,a_s_given_mm=h-h0,
            rho_given_gross=area/(b*h),rho_min=rho_min,As_min_mm2=area_min,xi_b=xi_b,
            x_limit_mm=x_limit,As_yield_limit_mm2=area_limit,x_yield_assumed_mm=x,
            xi_yield_assumed=x/h0)
        # 仅处理浮点舍入；不构成设计放宽。
        if area<area_min*(1-1e-12):
            result.update(capacity_status="below_minimum_reinforcement",reason="低于本版普通梁最小配筋要求，不生成正常Mu回归标签。")
            return result
        if x>x_limit*(1+1e-12):
            result.update(capacity_status="beyond_single_reinforced_method",reason="超过单筋屈服简式界限；不能继续假定钢筋应力为fy，需另行受力计算。")
            return result
        mu=fy*area*(h0-x/2)/1e6
        if not math.isfinite(mu) or mu<=0:
            raise ValueError("承载力计算产生非正或非有限数值")
        result.update(Mu_reference_kNm=mu,capacity_status="ok",reason="得到当前单筋简式下的规范正截面受弯承载力。",
            reference_bending_check="not_evaluated" if moment is None else ("meets" if mu>=moment else "insufficient"))
    except (TypeError,ValueError,OverflowError,ZeroDivisionError) as exc:
        result.update(capacity_status="invalid_input",Mu_reference_kNm=None,reason=str(exc))
    return result
