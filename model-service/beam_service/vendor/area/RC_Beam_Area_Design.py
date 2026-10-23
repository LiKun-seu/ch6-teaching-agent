# -*- coding: utf-8 -*-
"""面积公式底层函数：本实验由预估单排几何模块提供 h0。
普通非抗震单筋矩形截面，计算受弯与最小配筋要求下的连续面积。

输出连续所需面积，不进行钢筋枚举、选筋、排数判断或完整梁设计。
M_design_kNm 是本截面计算采用的设计弯矩，已经包含应计入的 gamma0。
"""
import sys
sys.dont_write_bytecode = True
import argparse
import json
import math
from .RC_Beam_Code_Parameters import (
    ALPHA1, BETA1, CONCRETE, DESIGN_SCOPE, EPSILON_CU, METHOD_VERSION,
    MOMENT_BASIS, RHO_MIN_CONSTANT, RHO_MIN_FT_FACTOR, STANDARDS, STEEL,
)

RESULT_COLUMNS = [
    "b_mm", "h_mm", "h0_mm", "concrete", "steel", "M_design_kNm",
    "fc_MPa", "ft_MPa", "fy_MPa", "Es_MPa", "alpha1", "beta1", "epsilon_cu",
    "a_s_given_mm", "xi_b", "x_limit_mm", "M_limit_kNm", "alpha_s",
    "xi_required", "x_required_mm", "As_bending_mm2", "rho_min",
    "As_min_mm2", "As_required_mm2", "rho_required_gross", "M_backcheck_kNm",
    "control", "status", "reason", "method_version", "design_scope", "moment_basis",
]

def design_area(b_mm, h_mm, h0_mm, concrete, steel, M_design_kNm,
                design_scope=DESIGN_SCOPE, moment_basis=MOMENT_BASIS):
    """返回字典；计算失败/范围不支持时，As_required_mm2 为 None。

    status: ok / invalid_input / unsupported_scope / needs_redesign。
    needs_redesign 仅表示超出给定单筋截面方法，不能据此否定双筋等方案。
    """
    result = dict.fromkeys(RESULT_COLUMNS)
    result.update(method_version=METHOD_VERSION, design_scope=design_scope,
                  moment_basis=moment_basis, status="invalid_input")
    if design_scope != DESIGN_SCOPE or moment_basis != MOMENT_BASIS:
        result.update(status="unsupported_scope", reason="仅支持普通非抗震矩形单筋方法，弯矩须已包含应计入的结构重要性系数。")
        return result
    raw = {"b_mm": b_mm, "h_mm": h_mm, "h0_mm": h0_mm, "M_design_kNm": M_design_kNm}
    try:
        if any(isinstance(value, bool) for value in raw.values()):
            raise ValueError("数值输入不能为布尔值")
        values = {name: float(value) for name, value in raw.items()}
        if not all(math.isfinite(value) for value in values.values()):
            raise ValueError("数值输入必须有限，不能有 NaN/无穷大")
    except (TypeError, ValueError, OverflowError) as exc:
        result["reason"] = str(exc)
        return result
    result.update(values)
    b, h, h0, moment = (values[name] for name in raw)
    if b <= 0 or h <= 0 or not 0 < h0 < h or moment < 0:
        result["reason"] = "须满足 b>0、h>0、0<h0<h、M>=0；底部受拉模式不接受负弯矩。"
        return result
    if not isinstance(concrete, str) or not isinstance(steel, str):
        result["reason"] = "混凝土与钢筋等级必须为字符串"
        return result
    concrete, steel = concrete.strip().upper(), steel.strip().upper()
    result.update(concrete=concrete, steel=steel)
    if concrete not in CONCRETE or steel not in STEEL:
        result.update(status="unsupported_scope", reason="本版本支持 C30/C35/C40 和 HRB400/HRB500，不自动推算其他材料参数。")
        return result
    fc, ft = CONCRETE[concrete]["fc_MPa"], CONCRETE[concrete]["ft_MPa"]
    fy, es = STEEL[steel]["fy_MPa"], STEEL[steel]["Es_MPa"]
    xi_b = BETA1 / (1.0 + fy / (es * EPSILON_CU))
    rho_min = max(RHO_MIN_CONSTANT, RHO_MIN_FT_FACTOR * ft / fy)
    try:
        stiffness = ALPHA1 * fc * b
        moment_nmm = moment * 1e6
        limit_nmm = stiffness * h0 * h0 * xi_b * (1.0 - xi_b / 2.0)
        area_min = rho_min * b * h
        if not all(math.isfinite(v) and v > 0 for v in (stiffness, limit_nmm, area_min)) or not math.isfinite(moment_nmm):
            raise ArithmeticError("输入数量级超出浮点计算支持范围")
        result.update(fc_MPa=fc, ft_MPa=ft, fy_MPa=fy, Es_MPa=es,
                      alpha1=ALPHA1, beta1=BETA1, epsilon_cu=EPSILON_CU,
                      a_s_given_mm=h-h0, xi_b=xi_b, x_limit_mm=xi_b*h0,
                      M_limit_kNm=limit_nmm/1e6, rho_min=rho_min, As_min_mm2=area_min)
        # 1e-12 相对误差仅处理界限处浮点舍入，不构成设计放宽系数。
        if moment_nmm > limit_nmm * (1.0 + 1e-12):
            result.update(status="needs_redesign", reason="M 超过给定截面、材料和 h0 下的单筋受弯限值；需调整截面/材料或另做双筋设计。")
            return result
        alpha_s = moment_nmm / (stiffness * h0 * h0)
        discriminant = 1.0 - 2.0 * alpha_s
        if discriminant < 0:
            raise ArithmeticError("判别式为负，不能继续按本方法计算")
        # 与 1-sqrt(1-2*alpha_s) 等价，避免小弯矩时相近数相减。
        xi = 2.0 * alpha_s / (1.0 + math.sqrt(discriminant))
        x = xi * h0
        area_bending = stiffness * x / fy
        required = max(area_bending, area_min)
        backcheck = stiffness * x * (h0-x/2.0) / 1e6
        if xi > xi_b + 1e-12 or not math.isfinite(required):
            raise ArithmeticError("界限或数值检查失败")
        if not math.isclose(backcheck, moment, rel_tol=1e-10, abs_tol=1e-10):
            raise ArithmeticError("受弯面积代回平衡方程不一致")
        result.update(alpha_s=alpha_s, xi_required=xi, x_required_mm=x,
                      As_bending_mm2=area_bending, As_required_mm2=required,
                      rho_required_gross=required/(b*h), M_backcheck_kNm=backcheck,
                      control="minimum_reinforcement" if area_min >= area_bending else "bending",
                      status="ok", reason="按给定 h0 完成正截面受弯与最小配筋面积计算。")
    except (ArithmeticError, OverflowError, ZeroDivisionError) as exc:
        result.update(status="invalid_input", reason=str(exc))
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--b", type=float, default=300, help="宽度 mm")
    parser.add_argument("--h", type=float, default=600, help="总高度 mm")
    parser.add_argument("--h0", type=float, default=560, help="明确给定的有效高度 mm")
    parser.add_argument("--concrete", default="C30")
    parser.add_argument("--steel", default="HRB400")
    parser.add_argument("--moment", type=float, default=250, help="已包含应计入 gamma0 的设计弯矩 kN·m")
    parser.add_argument("--output", help="可选：另存 JSON 计算记录，既有文件不覆盖")
    args = parser.parse_args()
    result = design_area(args.b, args.h, args.h0, args.concrete, args.steel, args.moment)
    control = {"bending": "受弯承载力控制", "minimum_reinforcement": "最小配筋控制"}.get(result["control"], "无有效面积标签")
    print("规范：" + "；".join(STANDARDS))
    print("计算范围：普通非抗震矩形梁，不计受压钢筋作用；明确给定 h0。")
    print("状态：", result["status"], "；", result["reason"])
    if result["status"] == "ok":
        print(f"受弯计算面积：{result['As_bending_mm2']:.6f} mm²")
        print(f"最小钢筋面积：{result['As_min_mm2']:.6f} mm²")
        print(f"所需受拉钢筋面积：{result['As_required_mm2']:.6f} mm²；{control}")
        print(f"单筋界限弯矩：{result['M_limit_kNm']:.6f} kN·m")
    if args.output:
        from pathlib import Path
        with Path(args.output).open("x", encoding="utf-8") as stream:
            json.dump(result, stream, ensure_ascii=False, indent=2, allow_nan=False)
    return 0 if result["status"] == "ok" else 2

if __name__ == "__main__":
    raise SystemExit(main())
