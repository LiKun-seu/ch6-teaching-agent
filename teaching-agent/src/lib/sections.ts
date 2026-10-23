/** 第六章知识点编号（与 ch6-knowledge.md 的结构图一致）
 *  K1~K11 有 PPT 页；K12~K14（受扭/变形/裂缝）PPT 中未出现，内容来自教材扫描件与题库。
 */
export const KNOWLEDGE_SECTIONS = [
  { id: "K1", name: "概述", only: "ppt" },
  { id: "K2", name: "正截面承载力·构造要求", only: "ppt" },
  { id: "K3", name: "正截面试验研究与破坏形态", only: "ppt" },
  { id: "K4", name: "正截面受力分析与基本规定", only: "ppt" },
  { id: "K5", name: "单筋矩形截面计算", only: "ppt" },
  { id: "K6", name: "双筋矩形截面梁", only: "ppt" },
  { id: "K7", name: "T 形截面梁", only: "ppt" },
  { id: "K8", name: "斜截面受剪·破坏形态", only: "ppt" },
  { id: "K9", name: "无腹筋梁抗剪性能", only: "ppt" },
  { id: "K10", name: "有腹筋梁受剪性能", only: "ppt" },
  { id: "K11", name: "斜截面受剪承载力计算", only: "ppt" },
  { id: "K12", name: "受扭构件·弯剪扭", only: "book" },
  { id: "K13", name: "变形（挠度）验算", only: "book" },
  { id: "K14", name: "裂缝宽度验算", only: "book" },
] as const;

export type SectionId = (typeof KNOWLEDGE_SECTIONS)[number]["id"];

export const KNOWLEDGE_INDEX = KNOWLEDGE_SECTIONS.map((s) => s.id) as readonly string[];

export function sectionLabel(id: string): string {
  const s = KNOWLEDGE_SECTIONS.find((x) => x.id === id);
  return s ? s.name : id;
}
