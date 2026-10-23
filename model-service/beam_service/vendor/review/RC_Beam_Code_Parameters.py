# -*- coding: utf-8 -*-
"""复核模型使用的限定规范参数；采样设置另见review_sampling_config.json。"""
METHOD_VERSION = "GB_rectangular_review_given_As_h0_v1"
DESIGN_SCOPE = "ordinary_nonseismic_rectangular_singly_reinforced"
MOMENT_BASIS = "design_moment_including_gamma0"
STANDARDS = ["GB 55008-2021", "GB/T 50010-2010（2024年版）"]
# fc、ft、fy、Es 均为 N/mm²；采用设计值，不使用等级名称中的数值代替。
CONCRETE = {
    "C30": {"fc_MPa": 14.3, "ft_MPa": 1.43},
    "C35": {"fc_MPa": 16.7, "ft_MPa": 1.57},
    "C40": {"fc_MPa": 19.1, "ft_MPa": 1.71},
}
STEEL = {
    "HRB400": {"fy_MPa": 360.0, "Es_MPa": 200000.0},
    "HRB500": {"fy_MPa": 435.0, "Es_MPa": 200000.0},
}
# 这里只支持 C30/C35/C40；扩展等级时必须同时更新参数和验证。
ALPHA1 = 1.0
BETA1 = 0.80
EPSILON_CU = 0.0033
RHO_MIN_CONSTANT = 0.002
RHO_MIN_FT_FACTOR = 0.45
REFERENCES = {
    "moment": {"clause": "GB/T 50010 3.3.2", "url": "https://gf.cabr-fire.com/article-12586.htm"},
    "concrete": {"clause": "GB/T 50010 4.1.4", "url": "https://gf.cabr-fire.com/article-12593.htm"},
    "steel": {"clause": "GB/T 50010 4.2.3、4.2.5（HRB400/HRB500）", "url": "https://gf.cabr-fire.com/article-12594.htm"},
    "flexure": {"clause": "GB/T 50010 6.2.6、6.2.7、6.2.10、6.2.13", "url": "https://gf.cabr-fire.com/m/article-12605.htm"},
    "minimum": {"clause": "GB 55008 4.4.6；GB/T 50010 8.5.1", "url": "https://gf.cabr-fire.com/article-39674.htm"},
    "minimum_cross_reference": {"clause": "GB/T 50010 8.5.1", "url": "https://gf.cabr-fire.com/article-12619.htm"},
    "revision": {"clause": "2024年局部修订说明（删除HRB335）", "url": "https://www.cabrtech.com/cabrtech/xwzx/kygd/2024/10/I1301230310721060865.html"},
}
