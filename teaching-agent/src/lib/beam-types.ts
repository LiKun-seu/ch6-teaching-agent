export type BeamTask = "design" | "review";

export type BeamClassName = "少筋" | "适筋" | "超筋";

export type BeamDesignRequest = {
  b_mm: number;
  h_mm: number;
  concrete: string;
  steel: string;
  M_design_kNm: number;
  h0_mm?: number;
  environment_class?: string;
  design_life_years?: number;
  stirrup_d_mm?: number;
  assumed_longitudinal_d_mm?: number;
};

export type BeamReviewRequest = {
  b_mm: number;
  h_mm: number;
  h0_mm: number;
  concrete: string;
  steel: string;
  As_provided_mm2: number;
  M_design_kNm?: number;
};

export type BeamResult = {
  task: BeamTask;
  status: string;
  inputs: Record<string, unknown>;
  geometry: { h0_mm: number; basis: string; [key: string]: unknown };
  classification: {
    class_name: BeamClassName;
    label: string;
    probabilities: Record<BeamClassName, number>;
  };
  prediction: {
    value: number;
    unit: "mm²" | "kN·m";
    model_key: string;
  } | null;
  reference: Record<string, unknown>;
  comparison: {
    model_minus_reference: number;
    relative_error_percent: number;
    model_meets?: boolean;
    reference_meets?: boolean;
    decision_disagrees?: boolean;
  } | null;
  warnings: string[];
  model_versions: Record<string, string>;
  scope: string;
};

export const BEAM_CLASS_ORDER: BeamClassName[] = ["少筋", "适筋", "超筋"];

/** 分类 A 的训练简称描述设计需求，不代表一根实配梁的破坏形态。 */
export const BEAM_DESIGN_CLASS_LABELS: Record<BeamClassName, string> = {
  少筋: "最小配筋控制",
  适筋: "正常单筋设计",
  超筋: "超过单筋设计限值",
};

export const BEAM_REVIEW_CLASS_LABELS: Record<BeamClassName, string> = {
  少筋: "实配面积低于最小配筋",
  适筋: "实配面积处于适筋范围",
  超筋: "超过单筋简式界限",
};

export function beamClassLabel(task: BeamTask, name: BeamClassName): string {
  return (task === "design" ? BEAM_DESIGN_CLASS_LABELS : BEAM_REVIEW_CLASS_LABELS)[name] ?? name;
}

export function beamNumber(value: unknown, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("zh-CN", { maximumFractionDigits: digits, minimumFractionDigits: digits })
    : "—";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 防止代理的非 JSON 错误或不完整响应在结果视图中产生未捕获异常。 */
export function isBeamResult(value: unknown): value is BeamResult {
  if (!isRecord(value)) return false;
  if (value.task !== "design" && value.task !== "review") return false;
  if (typeof value.status !== "string" || typeof value.scope !== "string") return false;
  if (!isRecord(value.inputs) || !isRecord(value.reference) || !isRecord(value.geometry)) return false;
  if (!Number.isFinite(value.geometry.h0_mm) || typeof value.geometry.basis !== "string") return false;
  if (!isRecord(value.classification) || !isRecord(value.classification.probabilities)) return false;
  if (!BEAM_CLASS_ORDER.includes(value.classification.class_name as BeamClassName)) return false;
  const probabilities = value.classification.probabilities;
  if (!BEAM_CLASS_ORDER.every((name) => typeof probabilities[name] === "number" && Number.isFinite(probabilities[name]))) return false;
  if (value.prediction !== null && (!isRecord(value.prediction) || typeof value.prediction.value !== "number" || !Number.isFinite(value.prediction.value) || !["mm²", "kN·m"].includes(value.prediction.unit as string) || typeof value.prediction.model_key !== "string")) return false;
  if (value.comparison !== null && !isRecord(value.comparison)) return false;
  if (!Array.isArray(value.warnings) || !value.warnings.every((warning) => typeof warning === "string")) return false;
  return isRecord(value.model_versions);
}

export function beamErrorMessage(body: unknown, status: number): string {
  if (isRecord(body)) {
    if (typeof body.error === "string") return body.error;
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail)) {
      const messages = body.detail.flatMap((item) => {
        if (!isRecord(item) || typeof item.msg !== "string") return [];
        const field = Array.isArray(item.loc) ? item.loc.filter((part) => part !== "body").join(".") : "";
        return [field ? `${field}：${item.msg}` : item.msg];
      });
      if (messages.length) return messages.join("；");
    }
  }
  return status === 422 ? "输入参数不符合当前模型的适用条件，请检查并修改。" : `计算请求失败（HTTP ${status}），请稍后重试。`;
}
