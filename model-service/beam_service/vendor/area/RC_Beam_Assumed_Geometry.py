# -*- coding: utf-8 -*-
"""按预估单排位置求h0；不选筋、不检查最终根数能否放下。"""
import math
H0_BASIS = "assumed_single_layer_cover_stirrup_diameter_v1"
COVER_50_MM = {"I":20.,"IIa":25.,"IIb":35.,"IIIa":40.,"IIIb":50.}
MIN_CONCRETE_50 = {"I":25,"IIa":25,"IIb":30,"IIIa":35,"IIIb":40}
LONGITUDINAL_DIAMETERS = (14,16,18,20,22,25,28,32)
STIRRUP_DIAMETERS = (8,10)
GEOMETRY_COLUMNS = ["environment_class","design_life_years","cover_table_mm",
    "cover_to_stirrup_mm","stirrup_d_mm","assumed_longitudinal_d_mm",
    "assumed_rows","a_s_assumed_mm","h0_basis","placement_status"]

def normalize_environment(value):
    if not isinstance(value,str):
        raise ValueError("环境类别须为I/IIa/IIb/IIIa/IIIb")
    aliases={"i":"I","ii a":"IIa","iia":"IIa","iib":"IIb","iiia":"IIIa","iiib":"IIIb",
             "一":"I","二a":"IIa","二b":"IIb","三a":"IIIa","三b":"IIIb"}
    key=value.strip().lower()
    if key not in aliases:
        raise ValueError("环境类别须为I/IIa/IIb/IIIa/IIIb")
    return aliases[key]

def finite_number(name,value):
    if isinstance(value,bool):
        raise ValueError(name+"不能为布尔值")
    try: value=float(value)
    except (TypeError,ValueError,OverflowError): raise ValueError(name+"须为有限数值") from None
    if not math.isfinite(value): raise ValueError(name+"须为有限数值")
    return value

def assumed_geometry(h_mm,concrete,environment_class="IIa",design_life_years=50,
                     stirrup_d_mm=8,assumed_longitudinal_d_mm=20,*,allow_unlisted_diameters=False):
    """默认保留固定实验规格；预测入口可允许白名单以外的正有限直径。

    放宽直径输入不代表完成实际布筋或构造验算，保护层与h0计算方式不变。
    """
    h=finite_number("h",h_mm);life=finite_number("使用年限",design_life_years)
    stirrup=finite_number("箍筋直径",stirrup_d_mm)
    diameter=finite_number("预估纵筋直径",assumed_longitudinal_d_mm)
    env=normalize_environment(environment_class)
    if not isinstance(concrete,str) or concrete.strip().upper() not in ("C30","C35","C40"):
        raise ValueError("只支持C30/C35/C40")
    concrete=concrete.strip().upper();grade=int(concrete[1:])
    if life not in (50,100): raise ValueError("只支持50年或100年")
    if life==100 and env!="I":
        raise ValueError("二、三类环境100年需要专门耐久性措施，本版未实现；不能仅乘1.4代替这些措施")
    if grade < (30 if life==100 else MIN_CONCRETE_50[env]):
        raise ValueError("环境与混凝土最低强度等级不匹配；不采用引气或工程经验等放宽条件")
    if stirrup<=0:raise ValueError("箍筋直径须大于0 mm")
    if diameter<=0:raise ValueError("预估纵筋直径须大于0 mm")
    if not isinstance(allow_unlisted_diameters,bool):raise ValueError("直径范围放宽开关须为布尔值")
    if not allow_unlisted_diameters and (stirrup not in STIRRUP_DIAMETERS or diameter not in LONGITUDINAL_DIAMETERS):
        raise ValueError("本版箍筋8/10 mm；预估纵筋直径14/16/18/20/22/25/28/32 mm")
    table=COVER_50_MM[env]*(1.4 if life==100 else 1.)
    # c到箍筋外缘；纵筋外缘保护层为c+d箍，需不小于d纵。
    cover=max(table,diameter-stirrup,stirrup)
    a_s=cover+stirrup+diameter/2;h0=h-a_s
    if h<=0 or not 0<h0<h: raise ValueError("几何条件须满足h>0且0<h0<h")
    return dict(environment_class=env,design_life_years=int(life),cover_table_mm=table,
        cover_to_stirrup_mm=cover,stirrup_d_mm=stirrup,assumed_longitudinal_d_mm=diameter,
        assumed_rows=1,a_s_assumed_mm=a_s,h0_mm=h0,h0_basis=H0_BASIS,
        placement_status="preliminary_not_checked")
