"""严格的网页请求边界；数值只接受 JSON 数字，拒绝布尔、字符串及非有限数。"""
import math
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, model_validator

from .vendor.review.RC_Beam_Review_Core import validate_project_section


def finite_number(value):
    if type(value) not in (int, float):
        raise ValueError("必须填写数值，不能使用字符串或布尔值")
    try:
        value = float(value)
    except (ValueError, OverflowError):
        raise ValueError("数值必须有限，不能有 NaN 或无穷大") from None
    if not math.isfinite(value):
        raise ValueError("数值必须有限，不能有 NaN 或无穷大")
    if abs(value) > 3.4028234663852886e38 or 0 < abs(value) < 1.401298464324817e-45:
        raise ValueError("输入数量级超出模型数值表示范围，请检查单位")
    return value


Number = Annotated[float, BeforeValidator(finite_number)]


class SectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    b_mm: Number
    h_mm: Number
    concrete: Literal["C30", "C35", "C40"]
    steel: Literal["HRB400", "HRB500"]

    @model_validator(mode="after")
    def section_is_supported(self):
        validate_project_section(self.b_mm, self.h_mm)
        return self


class DesignRequest(SectionRequest):
    M_design_kNm: Number
    h0_mm: Number | None = None
    environment_class: Literal["I", "IIa", "IIb", "IIIa", "IIIb"] = "I"
    design_life_years: Number = 50
    stirrup_d_mm: Number = 8
    assumed_longitudinal_d_mm: Number = 20

    @model_validator(mode="after")
    def valid_design(self):
        if self.M_design_kNm < 0:
            raise ValueError("设计弯矩必须大于或等于 0")
        if self.h0_mm is not None and not 0 < self.h0_mm < self.h_mm:
            raise ValueError("有效高度须满足 0 < h0 < h")
        if self.h0_mm is None:
            if self.design_life_years not in (50, 100):
                raise ValueError("设计使用年限只支持 50 年或 100 年")
            if self.stirrup_d_mm <= 0 or self.assumed_longitudinal_d_mm <= 0:
                raise ValueError("箍筋直径与预估纵筋直径必须大于 0 mm")
        return self


class ReviewRequest(SectionRequest):
    h0_mm: Number
    As_provided_mm2: Number
    M_design_kNm: Number | None = None

    @model_validator(mode="after")
    def valid_review(self):
        if not 0 < self.h0_mm < self.h_mm:
            raise ValueError("有效高度须满足 0 < h0 < h")
        if self.As_provided_mm2 < 0:
            raise ValueError("实配钢筋面积必须大于或等于 0")
        if self.M_design_kNm is not None and self.M_design_kNm < 0:
            raise ValueError("设计弯矩必须大于或等于 0")
        return self
