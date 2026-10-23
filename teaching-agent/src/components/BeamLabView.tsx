"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, ArrowRight, Calculator, CheckCircle2, ChevronDown, Download, FlaskConical, Layers3, LoaderCircle, MessageSquare, RotateCcw, Ruler, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { AiSidePanel, useAiDrawer } from "@/components/AiDrawer";
import { appPath } from "@/lib/app-path";
import {
  BEAM_CLASS_ORDER, beamClassLabel, beamErrorMessage, beamNumber, isBeamResult,
  type BeamDesignRequest, type BeamResult, type BeamReviewRequest, type BeamTask,
} from "@/lib/beam-types";

type BeamForm = {
  b: string; h: string; h0: string; concrete: string; steel: string; moment: string;
  area: string; geometryMode: "estimated" | "direct"; environment: string; life: string;
  stirrup: string; longitudinal: string;
};

const DESIGN_EXAMPLE: BeamForm = {
  b: "250", h: "500", h0: "462", concrete: "C30", steel: "HRB400", moment: "175",
  area: "", geometryMode: "estimated", environment: "I", life: "50", stirrup: "8", longitudinal: "20",
};
const REVIEW_EXAMPLE: BeamForm = {
  b: "200", h: "450", h0: "414", concrete: "C30", steel: "HRB400", moment: "80",
  area: "603", geometryMode: "direct", environment: "I", life: "50", stirrup: "8", longitudinal: "20",
};
const INPUT_LABELS: Record<string, string> = {
  b_mm: "梁宽 b", h_mm: "梁高 h", h0_mm: "有效高度 h₀", concrete: "混凝土", steel: "钢筋",
  M_design_kNm: "设计弯矩 M", As_provided_mm2: "实配面积 As", environment_class: "环境类别",
  design_life_years: "设计使用年限", stirrup_d_mm: "箍筋直径", assumed_longitudinal_d_mm: "预估纵筋直径",
};
const REFERENCE_LABELS: Record<string, string> = {
  As_required_mm2: "所需面积 As（mm²）", As_min_mm2: "最小配筋面积（mm²）",
  As_max_mm2: "单筋界限面积（mm²）", As_provided_mm2: "实配面积（mm²）",
  Mu_reference_kNm: "抗弯承载力 Mu（kN·m）", Mu_limit_kNm: "单筋极限弯矩（kN·m）",
  M_design_kNm: "设计弯矩 M（kN·m）", x_mm: "受压区高度 x（mm）", xi: "相对受压区高度 ξ",
  xi_b: "界限相对受压区高度 ξb", rho: "配筋率 ρ", rho_min: "最小配筋率 ρmin",
  As_yield_limit_mm2: "单筋界限面积（mm²）", M_limit_kNm: "单筋极限弯矩（kN·m）",
  x_required_mm: "所需受压区高度（mm）", x_yield_assumed_mm: "假定钢筋屈服的受压区高度（mm）",
  xi_required: "所需相对受压区高度 ξ", rho_given_gross: "实配配筋率 ρ（按全截面）",
  rho_required_gross: "所需配筋率 ρ（按全截面）", xi_yield_assumed: "屈服假定下相对受压区高度 ξ",
};
const GEOMETRY_BASIS_LABELS: Record<string, string> = {
  provided_effective_height: "填写的有效高度",
  assumed_single_layer_cover_stirrup_diameter_v1: "按预估单排位置计算",
};
const STATUS_LABELS: Record<string, string> = {
  ok: "当前规则范围内", needs_redesign: "需要调整截面或设计方案",
  below_minimum_reinforcement: "实配面积低于最小配筋",
  beyond_single_reinforced_method: "超出当前单筋简式适用范围",
};

function requestFor(task: BeamTask, form: BeamForm): BeamDesignRequest | BeamReviewRequest {
  const common = { b_mm: Number(form.b), h_mm: Number(form.h), concrete: form.concrete, steel: form.steel };
  if (task === "review") {
    return { ...common, h0_mm: Number(form.h0), As_provided_mm2: Number(form.area), ...(form.moment.trim() ? { M_design_kNm: Number(form.moment) } : {}) };
  }
  if (form.geometryMode === "direct") {
    return { ...common, M_design_kNm: Number(form.moment), h0_mm: Number(form.h0) };
  }
  return {
    ...common, M_design_kNm: Number(form.moment),
    environment_class: form.environment, design_life_years: Number(form.life),
    stirrup_d_mm: Number(form.stirrup), assumed_longitudinal_d_mm: Number(form.longitudinal),
  };
}

function referenceReason(result: BeamResult): string | null {
  for (const key of ["reason", "message", "note"]) {
    const value = result.reference[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function resultSummary(result: BeamResult): string {
  return JSON.stringify({
    任务: result.task === "design" ? "给定弯矩求配筋" : "实配钢筋复核",
    规则状态: result.status, 输入: result.inputs, 几何: result.geometry,
    模型分类: beamClassLabel(result.task, result.classification.class_name),
    模型分类概率: result.classification.probabilities, 模型预测: result.prediction,
    公式参考: result.reference, 比较: result.comparison, 提示: result.warnings, 适用范围: result.scope,
  }, null, 2);
}

/** 表单和结果属于本视图；AI 对话沿用全站 AiDrawerProvider。 */
export function BeamLabView({ active = true }: { active?: boolean }) {
  const [task, setTask] = useState<BeamTask>("design");
  const [forms, setForms] = useState<Record<BeamTask, BeamForm>>({ design: { ...DESIGN_EXAMPLE }, review: { ...REVIEW_EXAMPLE } });
  const [result, setResult] = useState<BeamResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [edited, setEdited] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const submitting = useRef(false);
  const { ask, open, bindSlide } = useAiDrawer();
  const form = forms[task];

  useEffect(() => { if (active) bindSlide(null); }, [active, bindSlide]);
  useEffect(() => () => controller.current?.abort(), []);

  const clearResult = () => { if (result) setEdited(true); setResult(null); setError(null); };
  const update = (key: keyof BeamForm, value: string) => {
    clearResult();
    setForms((current) => ({ ...current, [task]: { ...current[task], [key]: value } }));
  };
  const chooseTask = (next: BeamTask) => {
    if (submitting.current || task === next) return;
    setTask(next); setResult(null); setError(null); setEdited(false);
  };
  const resetExample = () => {
    if (submitting.current) return;
    setForms((current) => ({ ...current, [task]: { ...(task === "design" ? DESIGN_EXAMPLE : REVIEW_EXAMPLE) } }));
    setResult(null); setError(null); setEdited(false);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    const request = requestFor(task, form);
    const values = Object.values(request).filter((value) => typeof value === "number");
    if (values.some((value) => !Number.isFinite(value))) {
      setError("请填写完整、有效的数值。"); submitting.current = false; return;
    }
    if (request.b_mm <= 0 || request.h_mm <= 0 || ("h0_mm" in request && request.h0_mm !== undefined && (request.h0_mm <= 0 || request.h0_mm >= request.h_mm))) {
      setError("梁宽、梁高应大于 0，有效高度 h₀ 应大于 0 且小于梁高 h。"); submitting.current = false; return;
    }
    setLoading(true); setResult(null); setError(null); setEdited(false);
    const abort = new AbortController();
    controller.current = abort;
    const timer = window.setTimeout(() => abort.abort(), 60_000);
    try {
      const response = await fetch(appPath(`/api/beam/${task}`), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request), signal: abort.signal,
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(beamErrorMessage(body, response.status));
      if (!isBeamResult(body) || body.task !== task) throw new Error("计算服务返回的结果不完整，请重试或检查服务状态。");
      setResult(body);
    } catch (cause) {
      setError(cause instanceof Error && cause.name === "AbortError"
        ? "计算请求超时或已取消，请确认本地模型服务已经启动后重试。"
        : cause instanceof Error ? cause.message : "暂时无法连接计算服务，请稍后重试。");
    } finally {
      window.clearTimeout(timer); controller.current = null; submitting.current = false; setLoading(false);
    }
  };

  const explain = () => {
    if (!result) return;
    bindSlide(null);
    ask({
      question: `请结合 K5 单筋矩形截面计算，用教学方式讲解下列实际模型调用结果。说明输入、规则适用性、模型值和公式参考的差异。数值以这份结果为准；如果预测为空或规则不适用，请解释原因和下一步，不补造数值。设计状态分类 A 不代表实配梁破坏形态；分类 B 的适筋也不等于承载力满足。\n\n${resultSummary(result)}`,
      context: { page: 0, section: "K5 单筋矩形截面计算" },
    });
  };

  const download = () => {
    if (!result) return;
    const file = new Blob([JSON.stringify(result, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url; link.download = `梁截面${result.task === "design" ? "配筋设计" : "实配复核"}-${new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" })}.json`;
    document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  const unit = task === "design" ? "mm²" : "kN·m";
  const referenceValue = result?.reference[task === "design" ? "As_required_mm2" : "Mu_reference_kNm"];
  const reason = result ? referenceReason(result) : null;
  const fields = [
    { key: "b" as const, label: "梁宽 b（mm）" },
    { key: "h" as const, label: "梁高 h（mm）" },
  ];

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1" style={{ fontFamily: '"Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif' }}>
      <div className={`min-h-0 min-w-0 flex-1 overflow-y-auto bg-slate-50/60 ${open && active ? "hidden md:block" : ""}`}>
        <main className="mx-auto w-full max-w-6xl space-y-5 px-4 pb-10 pt-5 sm:px-6 sm:pt-6">
          <header className="flex items-start gap-3 sm:gap-4">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-sky-100 bg-white text-sky-800 shadow-sm"><FlaskConical className="size-5" aria-hidden /></div>
            <div className="min-w-0 space-y-1.5">
              <p className="text-[11px] font-medium tracking-[0.12em] text-sky-800">第六章 · 模型与公式对照</p>
              <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-slate-900 sm:text-2xl">智能配筋实验</h1>
              <p className="max-w-3xl text-xs leading-5 text-slate-500 sm:text-[13px]">用训练得到的 CatBoost 模型探索单筋矩形截面的配筋设计与抗弯复核，并与公式参考比较。</p>
            </div>
          </header>

          <div className="flex flex-col gap-3 border-b border-slate-200/80 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="grid min-w-0 grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-slate-100/80 p-1" aria-label="选择实验任务">
              <Button type="button" variant="ghost" className={`h-auto min-w-0 justify-start gap-2 rounded-lg px-3 py-2.5 text-left text-xs font-medium sm:text-sm ${task === "design" ? "bg-white text-sky-900 shadow-sm hover:bg-white" : "text-slate-500 hover:bg-white/60 hover:text-slate-800"}`} disabled={loading} aria-pressed={task === "design"} onClick={() => chooseTask("design")}>
                <Calculator className="size-4 shrink-0" aria-hidden /><span className="min-w-0 whitespace-normal">给定弯矩求配筋<span className="mt-0.5 hidden text-[10px] font-normal text-slate-500 sm:block">设计状态 A ＋ 所需面积预测</span></span>
              </Button>
              <Button type="button" variant="ghost" className={`h-auto min-w-0 justify-start gap-2 rounded-lg px-3 py-2.5 text-left text-xs font-medium sm:text-sm ${task === "review" ? "bg-white text-sky-900 shadow-sm hover:bg-white" : "text-slate-500 hover:bg-white/60 hover:text-slate-800"}`} disabled={loading} aria-pressed={task === "review"} onClick={() => chooseTask("review")}>
                <ShieldCheck className="size-4 shrink-0" aria-hidden /><span className="min-w-0 whitespace-normal">实配钢筋复核<span className="mt-0.5 hidden text-[10px] font-normal text-slate-500 sm:block">配筋状态 B ＋ 抗弯承载力预测</span></span>
              </Button>
            </div>
            <p className="text-[11px] leading-5 text-slate-500">普通非抗震 · 非预应力 · 单筋矩形截面</p>
          </div>

          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
            <Card className="min-w-0 overflow-hidden rounded-2xl border-slate-200/90 bg-white shadow-sm shadow-slate-200/40">
              <CardHeader className="space-y-1.5 border-b border-slate-100 px-5 py-4">
                <div className="flex items-center justify-between gap-3"><CardTitle className="text-sm font-semibold text-slate-900">{task === "design" ? "设置设计条件" : "填写实际截面与配筋"}</CardTitle><span className="shrink-0 text-[10px] font-medium tracking-wider text-slate-500">输入参数</span></div>
                <CardDescription className="text-xs leading-5 text-slate-500">{task === "design" ? "由弯矩需求预测连续钢筋面积，选筋排布后再做实配复核。" : "填写实际几何与钢筋面积，比较承载力与弯矩需求。"}</CardDescription>
              </CardHeader>
              <CardContent className="px-5 pb-5 pt-4">
                <form onSubmit={submit}>
                  <fieldset disabled={loading} className="min-w-0 space-y-4">
                    <legend className="sr-only">{task === "design" ? "配筋设计参数" : "实配复核参数"}</legend>
                    <section className="space-y-3" aria-labelledby="beam-section-heading">
                      <h2 id="beam-section-heading" className="flex items-center gap-2 text-xs font-semibold text-slate-700"><Ruler className="size-3.5 text-sky-700" aria-hidden />截面尺寸</h2>
                      <div className="grid grid-cols-2 gap-3">
                        {fields.map(({ key, label }) => <label key={key} className="min-w-0 space-y-1.5 text-xs text-slate-600"><span>{label}</span><Input name={key} type="number" inputMode="decimal" min="0.01" step="any" required value={form[key]} onChange={(event) => update(key, event.target.value)} className="h-10 border-slate-200 bg-slate-50/40 text-sm tabular-nums shadow-none focus-visible:ring-sky-700/25" /></label>)}
                      </div>
                    </section>
                    <Separator className="bg-slate-100" />
                    <section className="space-y-3" aria-labelledby="beam-material-heading">
                      <h2 id="beam-material-heading" className="flex items-center gap-2 text-xs font-semibold text-slate-700"><Layers3 className="size-3.5 text-sky-700" aria-hidden />材料等级</h2>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="min-w-0 space-y-1.5 text-xs text-slate-600"><label htmlFor={`beam-${task}-concrete`}>混凝土等级</label><Select value={form.concrete} onValueChange={(value) => update("concrete", value)} disabled={loading}><SelectTrigger id={`beam-${task}-concrete`} className="h-10 border-slate-200 bg-slate-50/40 shadow-none focus:ring-sky-700/25"><SelectValue /></SelectTrigger><SelectContent>{["C30", "C35", "C40"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
                        <div className="min-w-0 space-y-1.5 text-xs text-slate-600"><label htmlFor={`beam-${task}-steel`}>钢筋等级</label><Select value={form.steel} onValueChange={(value) => update("steel", value)} disabled={loading}><SelectTrigger id={`beam-${task}-steel`} className="h-10 border-slate-200 bg-slate-50/40 shadow-none focus:ring-sky-700/25"><SelectValue /></SelectTrigger><SelectContent>{["HRB400", "HRB500"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
                      </div>
                    </section>
                    <Separator className="bg-slate-100" />
                    <section className="space-y-3" aria-labelledby="beam-geometry-heading">
                      <h2 id="beam-geometry-heading" className="flex items-center gap-2 text-xs font-semibold text-slate-700"><Calculator className="size-3.5 text-sky-700" aria-hidden />{task === "design" ? "有效高度与几何" : "实际有效高度与配筋"}</h2>
                      {task === "design" ? <>
                        <div className="space-y-1.5 text-xs text-slate-600"><label htmlFor="beam-geometry-mode">有效高度 h₀ 的来源</label><Select value={form.geometryMode} onValueChange={(value) => update("geometryMode", value)} disabled={loading}><SelectTrigger id="beam-geometry-mode" className="h-10 border-slate-200 bg-slate-50/40 shadow-none focus:ring-sky-700/25"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="estimated">按单排钢筋预估 h₀</SelectItem><SelectItem value="direct">直接填写 h₀</SelectItem></SelectContent></Select></div>
                        {form.geometryMode === "estimated" ? <>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="min-w-0 space-y-1.5 text-xs text-slate-600"><label htmlFor="beam-environment">环境类别</label><Select value={form.environment} onValueChange={(value) => update("environment", value)} disabled={loading}><SelectTrigger id="beam-environment" className="h-10 border-slate-200 bg-slate-50/40 shadow-none focus:ring-sky-700/25"><SelectValue /></SelectTrigger><SelectContent>{["I", "IIa", "IIb", "IIIa", "IIIb"].map((value) => <SelectItem key={value} value={value}>{value} 类</SelectItem>)}</SelectContent></Select></div>
                            <div className="min-w-0 space-y-1.5 text-xs text-slate-600"><label htmlFor="beam-life">设计使用年限</label><Select value={form.life} onValueChange={(value) => update("life", value)} disabled={loading}><SelectTrigger id="beam-life" className="h-10 border-slate-200 bg-slate-50/40 shadow-none focus:ring-sky-700/25"><SelectValue /></SelectTrigger><SelectContent>{["50", "100"].map((value) => <SelectItem key={value} value={value}>{value} 年</SelectItem>)}</SelectContent></Select></div>
                            <label className="min-w-0 space-y-1.5 text-xs text-slate-600"><span>箍筋直径（mm）</span><Input type="number" inputMode="decimal" required min="0.01" step="any" value={form.stirrup} onChange={(event) => update("stirrup", event.target.value)} className="h-10 border-slate-200 bg-slate-50/40 text-sm tabular-nums shadow-none focus-visible:ring-sky-700/25" /></label>
                            <label className="min-w-0 space-y-1.5 text-xs text-slate-600"><span>预估纵筋直径（mm）</span><Input type="number" inputMode="decimal" required min="0.01" step="any" value={form.longitudinal} onChange={(event) => update("longitudinal", event.target.value)} className="h-10 border-slate-200 bg-slate-50/40 text-sm tabular-nums shadow-none focus-visible:ring-sky-700/25" /></label>
                          </div>
                          <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-500">h₀ 按保护层与单排钢筋几何规则计算，以服务返回值为准。100 年仅支持 I 类；IIIa、IIIb 分别要求至少 C35、C40。</p>
                        </> : <label className="block space-y-1.5 text-xs text-slate-600"><span>有效高度 h₀（mm）</span><Input type="number" inputMode="decimal" required min="0.01" step="any" value={form.h0} onChange={(event) => update("h0", event.target.value)} className="h-10 border-slate-200 bg-slate-50/40 text-sm tabular-nums shadow-none focus-visible:ring-sky-700/25" /><span className="block text-[11px] leading-5 text-slate-500">受压边缘至受拉钢筋合力点的距离，应小于梁高。</span></label>}
                      </> : <div className="grid gap-3 sm:grid-cols-2">
                        <label className="min-w-0 space-y-1.5 text-xs text-slate-600"><span>实际有效高度 h₀（mm）</span><Input type="number" inputMode="decimal" required min="0.01" step="any" value={form.h0} onChange={(event) => update("h0", event.target.value)} className="h-10 border-slate-200 bg-slate-50/40 text-sm tabular-nums shadow-none focus-visible:ring-sky-700/25" /></label>
                        <label className="min-w-0 space-y-1.5 text-xs text-slate-600"><span>实配钢筋面积 As（mm²）</span><Input type="number" inputMode="decimal" required min="0.01" step="any" value={form.area} onChange={(event) => update("area", event.target.value)} className="h-10 border-slate-200 bg-slate-50/40 text-sm tabular-nums shadow-none focus-visible:ring-sky-700/25" /></label>
                      </div>}
                    </section>
                    <Separator className="bg-slate-100" />
                    <section className="space-y-3" aria-labelledby="beam-demand-heading">
                      <h2 id="beam-demand-heading" className="flex items-center gap-2 text-xs font-semibold text-slate-700"><ArrowRight className="size-3.5 text-sky-700" aria-hidden />弯矩需求</h2>
                      <label className="block space-y-1.5 text-xs text-slate-600"><span>设计弯矩 M（kN·m）{task === "review" ? " · 可选" : ""}</span><Input type="number" inputMode="decimal" required={task === "design"} min="0" step="any" value={form.moment} placeholder={task === "review" ? "留空则只计算承载力" : undefined} onChange={(event) => update("moment", event.target.value)} className="h-10 border-slate-200 bg-slate-50/40 text-sm tabular-nums shadow-none focus-visible:ring-sky-700/25" /></label>
                    </section>
                    <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                      <Button type="submit" disabled={loading} className="h-10 flex-1 gap-2 bg-sky-800 px-4 text-sm shadow-none hover:bg-sky-900 sm:flex-none sm:px-6">{loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <ArrowRight className="size-4" aria-hidden />}{loading ? "正在调用模型…" : error ? "修改后重试" : "开始计算"}</Button>
                      <Button type="button" variant="outline" onClick={resetExample} disabled={loading} className="h-10 gap-2 border-slate-200 text-xs text-slate-600 shadow-none"><RotateCcw className="size-3.5" aria-hidden />载入示例</Button>
                    </div>
                  </fieldset>
                </form>
                {error ? <div role="alert" className="mt-4 space-y-1 rounded-xl border border-red-200 bg-red-50/70 px-3.5 py-3 text-xs leading-6 text-red-800"><p className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-4 shrink-0" aria-hidden />本次计算未完成</p><p className="break-words">{error}</p><p className="text-[11px] text-red-700/75">输入已保留，检查参数或启动模型服务后可再次计算。</p></div> : null}
              </CardContent>
            </Card>

            <div className="min-w-0 space-y-4" aria-live="polite" aria-busy={loading}>
              {loading ? <Card className="rounded-2xl border-sky-100 bg-white shadow-sm shadow-slate-200/30"><CardContent className="flex min-h-80 flex-col items-center justify-center gap-4 p-6 text-center"><div className="flex size-14 items-center justify-center rounded-2xl bg-sky-50"><LoaderCircle className="size-6 animate-spin text-sky-700" aria-hidden /></div><p className="text-sm font-medium text-slate-800">正在执行规则检查、分类与数值预测…</p><p className="text-xs leading-5 text-slate-500">计算完成后，模型值与公式参考将在这里并列显示。</p></CardContent></Card> : null}
              {!result && !loading ? <Card className="overflow-hidden rounded-2xl border-slate-200/90 bg-white shadow-sm shadow-slate-200/30">
                <CardHeader className="space-y-2 px-5 pb-0 pt-5"><div className="flex items-center gap-2 text-[10px] font-semibold tracking-widest text-sky-700"><span className="size-1.5 rounded-full bg-sky-600" />实验预览</div><CardTitle className="text-lg font-semibold tracking-tight text-slate-900">{edited ? "参数已变更，请重新计算" : "从一个梁截面开始"}</CardTitle><CardDescription className="text-xs leading-5 text-slate-500">{edited ? "上一次结果已清除，页面只展示与当前提交参数对应的结果。" : "填写左侧条件，观察模型预测与规范公式的联系与差异。"}</CardDescription></CardHeader>
                <CardContent className="px-5 pb-5">
                  <figure className="mt-5 rounded-xl border border-slate-100 bg-slate-50/80 px-2 pb-3 pt-2">
                    <svg viewBox="0 0 360 260" role="img" aria-label="矩形梁截面概念示意：b为梁宽，h为梁高，h₀为受压边缘至受拉钢筋合力位置的距离。图中位置固定，不表示实际配筋排布。" className="mx-auto block h-auto w-full max-w-[340px] text-slate-500">
                      <rect x="116" y="34" width="126" height="164" rx="2" fill="#f1f5f9" stroke="#64748b" strokeWidth="1.5" />
                      <rect x="116" y="34" width="126" height="30" fill="#e0f2fe" />
                      <line x1="116" y1="64" x2="242" y2="64" stroke="#94a3b8" strokeDasharray="4 4" />
                      <line x1="116" y1="170" x2="242" y2="170" stroke="#0284c7" strokeDasharray="4 4" opacity="0.6" />
                      <circle cx="179" cy="170" r="7" fill="#0369a1" />
                      <circle cx="179" cy="170" r="12" fill="none" stroke="#7dd3fc" strokeWidth="1" />
                      <line x1="105" y1="34" x2="80" y2="34" stroke="#94a3b8" /><line x1="105" y1="198" x2="80" y2="198" stroke="#94a3b8" />
                      <line x1="88" y1="34" x2="88" y2="198" stroke="#94a3b8" /><line x1="84" y1="38" x2="92" y2="30" stroke="#94a3b8" /><line x1="84" y1="202" x2="92" y2="194" stroke="#94a3b8" />
                      <text x="67" y="121" fill="#64748b" fontSize="13">h</text>
                      <line x1="116" y1="211" x2="116" y2="234" stroke="#94a3b8" /><line x1="242" y1="211" x2="242" y2="234" stroke="#94a3b8" />
                      <line x1="116" y1="225" x2="242" y2="225" stroke="#94a3b8" /><line x1="112" y1="229" x2="120" y2="221" stroke="#94a3b8" /><line x1="238" y1="229" x2="246" y2="221" stroke="#94a3b8" />
                      <text x="175" y="248" fill="#64748b" fontSize="13">b</text>
                      <line x1="252" y1="34" x2="279" y2="34" stroke="#0284c7" opacity="0.6" /><line x1="252" y1="170" x2="279" y2="170" stroke="#0284c7" opacity="0.6" />
                      <line x1="270" y1="34" x2="270" y2="170" stroke="#0284c7" /><line x1="266" y1="38" x2="274" y2="30" stroke="#0284c7" /><line x1="266" y1="174" x2="274" y2="166" stroke="#0284c7" />
                      <text x="281" y="107" fill="#0369a1" fontSize="13">h₀</text>
                      <text x="179" y="151" textAnchor="middle" fill="#0369a1" fontSize="10">受拉钢筋合力位置</text>
                    </svg>
                    <figcaption className="text-center text-[10px] leading-5 text-slate-500">概念示意，非实际排布 · 图形不随输入按比例绘制</figcaption>
                  </figure>
                  <dl className="mt-4 grid grid-cols-3 gap-2 text-center"><div className="min-w-0 rounded-lg bg-slate-50 px-1 py-2"><dt className="text-[10px] text-slate-500">梁宽 b</dt><dd className="mt-1 break-words text-xs font-medium tabular-nums text-slate-700">{form.b || "—"}<span className="ml-1 text-[10px] font-normal text-slate-500">mm</span></dd></div><div className="min-w-0 rounded-lg bg-slate-50 px-1 py-2"><dt className="text-[10px] text-slate-500">梁高 h</dt><dd className="mt-1 break-words text-xs font-medium tabular-nums text-slate-700">{form.h || "—"}<span className="ml-1 text-[10px] font-normal text-slate-500">mm</span></dd></div><div className="min-w-0 rounded-lg bg-sky-50/70 px-1 py-2"><dt className="text-[10px] text-sky-700">有效高度 h₀</dt><dd className="mt-1 break-words text-xs font-medium tabular-nums text-sky-900">{task === "design" && form.geometryMode === "estimated" ? "待计算" : <>{form.h0 || "—"}<span className="ml-1 text-[10px] font-normal text-sky-700">mm</span></>}</dd></div></dl>
                  <p className="mt-4 text-xs leading-6 text-slate-500">{task === "design" ? "分类 A 判断弯矩需求对应的设计状态，不用于认定实配梁的少筋或超筋破坏。" : "分类 B 判断实际配筋所在区间；处于适筋范围后，还需要将承载力与设计弯矩比较。"}</p>
                </CardContent>
              </Card> : null}

              {result ? <>
                <Card className="overflow-hidden rounded-2xl border-sky-200/80 bg-white shadow-sm shadow-sky-100/40">
                  <CardHeader className="space-y-3 border-b border-slate-100 px-5 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[10px] font-semibold tracking-widest text-sky-700">实验结果</p><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium ${result.status === "ok" ? "bg-teal-50 text-teal-800" : "bg-amber-50 text-amber-800"}`}>{result.status === "ok" ? <CheckCircle2 className="size-3" aria-hidden /> : <AlertTriangle className="size-3" aria-hidden />}{STATUS_LABELS[result.status] ?? result.status}</span></div>
                    <CardTitle className="text-base font-semibold text-slate-900">{task === "design" ? "所需钢筋面积 As" : "抗弯承载力 Mu"}</CardTitle>
                    {reason ? <p className={`text-xs leading-5 ${result.status === "ok" ? "text-slate-500" : "text-amber-900"}`}>{reason}</p> : null}
                  </CardHeader>
                  <CardContent className="space-y-4 px-5 pb-5 pt-5">
                    <dl className="grid grid-cols-1 gap-4 min-[360px]:grid-cols-2 min-[360px]:gap-3 sm:gap-5">
                      <div className="min-w-0"><dt className="text-[11px] font-medium text-sky-700">CatBoost 预测</dt><dd className="mt-2 break-all text-[28px] font-semibold leading-tight tracking-tight tabular-nums text-sky-950 sm:text-[34px]">{result.prediction ? beamNumber(result.prediction.value) : "暂不预测"}</dd><dd className="mt-1 text-[11px] text-slate-500">{result.prediction ? result.prediction.unit : "超出当前回归模型适用范围"}</dd></div>
                      <div className="min-w-0 border-t border-slate-100 pt-4 min-[360px]:border-l min-[360px]:border-t-0 min-[360px]:pl-3 min-[360px]:pt-0 sm:pl-5"><dt className="text-[11px] font-medium text-slate-500">规范公式参考</dt><dd className="mt-2 break-all text-[28px] font-semibold leading-tight tracking-tight tabular-nums text-slate-800 sm:text-[34px]">{beamNumber(referenceValue)}</dd><dd className="mt-1 text-[11px] text-slate-500">{typeof referenceValue === "number" ? unit : "当前条件无适用数值"}</dd></div>
                    </dl>
                    {!result.prediction ? <p className="rounded-lg bg-amber-50/80 px-3 py-2 text-xs leading-5 text-amber-900">规则检查未允许调用当前回归模型。{reason || "请根据规则状态调整输入或设计方案。"}</p> : null}
                    {result.comparison ? <dl className="grid grid-cols-2 gap-3 rounded-xl border border-slate-100 bg-slate-50/80 px-3.5 py-3"><div className="min-w-0"><dt className="text-[10px] leading-4 text-slate-500">预测 − 公式参考</dt><dd className="mt-1.5 break-words text-sm font-semibold tabular-nums text-slate-800">{result.comparison.model_minus_reference > 0 ? "+" : ""}{beamNumber(result.comparison.model_minus_reference)} <span className="text-[10px] font-normal text-slate-500">{unit}</span></dd></div><div className="min-w-0"><dt className="text-[10px] leading-4 text-slate-500">相对差值<span className="block text-[9px] text-slate-500">以公式参考为基准</span></dt><dd className="mt-1.5 text-sm font-semibold tabular-nums text-slate-800">{result.comparison.relative_error_percent > 0 ? "+" : ""}{beamNumber(result.comparison.relative_error_percent)}%</dd></div></dl> : null}
                    {result.reference.control === "minimum_reinforcement" ? <p className="text-xs leading-5 text-sky-800">公式参考由最小配筋要求控制，选筋时应满足该下限。</p> : null}
                    {task === "review" && result.comparison && typeof result.comparison.reference_meets === "boolean" ? <div className="space-y-3"><dl className="grid grid-cols-2 gap-3 text-xs"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><dt className="text-slate-500">模型判断</dt><dd className={`font-semibold ${result.comparison.model_meets ? "text-teal-700" : "text-amber-800"}`}>{result.comparison.model_meets ? "满足" : "不满足"}</dd></div><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><dt className="text-slate-500">公式参考判断</dt><dd className={`font-semibold ${result.comparison.reference_meets ? "text-teal-700" : "text-amber-800"}`}>{result.comparison.reference_meets ? "满足" : "不满足"}</dd></div></dl>{result.comparison.decision_disagrees ? <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-medium leading-5 text-amber-900"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />模型与公式参考的满足判断不一致，请结合公式和边界条件复核。</p> : null}</div> : null}
                    {task === "review" && typeof result.inputs.M_design_kNm !== "number" ? <p className="text-[11px] leading-5 text-slate-500">未提供设计弯矩，本次仅计算承载力，不给出需求满足判断。</p> : null}
                    <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4"><Button type="button" variant="outline" size="sm" onClick={explain} className="h-9 gap-2 border-sky-200 bg-sky-50/70 text-xs text-sky-900 shadow-none hover:bg-sky-100"><MessageSquare className="size-3.5" aria-hidden />请 AI 讲解本次结果</Button><Button type="button" variant="ghost" size="sm" onClick={download} className="h-9 gap-2 px-2 text-xs text-slate-500 hover:bg-slate-50"><Download className="size-3.5" aria-hidden />下载结果 JSON</Button></div>
                    <p className="text-[10px] leading-5 text-slate-500">AI 讲解使用本次参数与计算结果；下载记录包含模型版本。</p>
                  </CardContent>
                </Card>

                {result.warnings.length ? <Card className="rounded-xl border-amber-200/80 bg-amber-50/50 shadow-none"><CardHeader className="px-4 pb-2 pt-3.5"><CardTitle className="flex items-center gap-2 text-xs font-semibold text-amber-900"><AlertTriangle className="size-4 shrink-0" aria-hidden />本次适用性提示</CardTitle></CardHeader><CardContent className="px-4 pb-3.5"><ul className="list-disc space-y-1.5 pl-4 text-xs leading-5 text-amber-900/80">{result.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul></CardContent></Card> : null}

                <Card className="rounded-2xl border-slate-200/90 bg-white shadow-none">
                  <CardHeader className="space-y-2 px-5 pb-3 pt-4"><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className="text-sm font-semibold text-slate-800">{result.task === "design" ? "设计状态分类 A" : "实配配筋状态分类 B"}</CardTitle><span className="rounded-md bg-sky-50 px-2 py-1 text-[10px] font-medium text-sky-800">{beamClassLabel(result.task, result.classification.class_name)}</span></div><CardDescription className="text-[11px] leading-5 text-slate-500">{result.task === "design" ? "判断弯矩需求对应的设计状态，不代表实配梁的破坏形态。" : "判断实际配筋区间；适筋类别本身不代表承载力满足。"}</CardDescription></CardHeader>
                  <CardContent className="space-y-3 px-5 pb-4"><dl className="space-y-3">{BEAM_CLASS_ORDER.map((name) => <div key={name}><div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs"><dt className={`min-w-0 ${name === result.classification.class_name ? "font-medium text-slate-800" : "text-slate-500"}`}>{beamClassLabel(result.task, name)}</dt><dd className="shrink-0 tabular-nums text-slate-500">{beamNumber(result.classification.probabilities[name] * 100, 1)}%</dd></div><div className="h-1 overflow-hidden rounded-full bg-slate-100" aria-hidden><div className={`h-full rounded-full ${name === result.classification.class_name ? "bg-sky-700" : "bg-slate-300"}`} style={{ width: `${Math.max(0, Math.min(100, result.classification.probabilities[name] * 100))}%` }} /></div></div>)}</dl><p className="pt-1 text-[11px] leading-5 text-slate-500">模型分类概率 · 不代表规范验算置信度</p></CardContent>
                </Card>

                <Card className="overflow-hidden rounded-xl border-slate-200/90 bg-white shadow-none"><details className="group"><summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-5 py-4 text-xs font-medium text-slate-700 marker:hidden [&::-webkit-details-marker]:hidden"><span>计算依据与记录<span className="ml-2 text-[10px] font-normal text-slate-500">输入与公式中间量</span></span><ChevronDown className="size-3.5 shrink-0 text-slate-500 transition-transform group-open:rotate-180" aria-hidden /></summary><CardContent className="space-y-4 border-t border-slate-100 px-5 pb-5 pt-4"><p className="text-xs leading-5 text-slate-600">有效高度 h₀ = <span className="font-medium tabular-nums text-slate-800">{beamNumber(result.geometry.h0_mm)} mm</span> · {GEOMETRY_BASIS_LABELS[result.geometry.basis] ?? result.geometry.basis}</p>
                  <dl className="grid gap-x-5 gap-y-2 text-[11px] sm:grid-cols-2">{Object.entries(result.inputs).filter(([key, value]) => key in INPUT_LABELS && (typeof value === "string" || typeof value === "number")).map(([key, value]) => <div key={key} className="flex justify-between gap-3"><dt className="text-slate-500">{INPUT_LABELS[key]}</dt><dd className="break-words text-right tabular-nums text-slate-700">{String(value)}</dd></div>)}</dl>
                  <Separator className="bg-slate-100" />
                  <dl className="grid gap-x-5 gap-y-2 text-[11px] sm:grid-cols-2">{Object.entries(result.reference).filter(([key, value]) => key in REFERENCE_LABELS && typeof value === "number" && Number.isFinite(value)).map(([key, value]) => <div key={key} className="flex justify-between gap-3"><dt className="text-slate-500">{REFERENCE_LABELS[key]}</dt><dd className="shrink-0 text-right tabular-nums text-slate-700">{beamNumber(value, ["rho", "rho_min", "xi", "xi_b", "xi_required", "rho_given_gross", "rho_required_gross", "xi_yield_assumed"].includes(key) ? 4 : 2)}</dd></div>)}</dl>
                  <p className="text-[11px] leading-5 text-slate-500">{result.scope}</p>
                </CardContent></details></Card>
              </> : null}
            </div>
          </div>
          <p className="max-w-3xl text-[10px] leading-5 text-slate-500">适用于当前训练和规则覆盖的普通非抗震、非预应力受弯任务。模型预测与公式参考应结合适用条件理解。</p>
        </main>
      </div>
      {active ? <AiSidePanel /> : null}
    </div>
  );
}
