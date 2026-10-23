/**
 * 清理浏览器选区的文字。
 *
 * 公式是 KaTeX 渲染出来的一堆 span，选中时 `Selection.toString()` 会把标签
 * 之间的换行一起带出来（"x\nb\n=ξ\nb\nh\n0"），收藏到笔记或「追问」出去
 * 就是一堆断行。这里把单换行压回空格，只保留真正的段落空行。
 */
export function tidySelection(raw: string): string {
  const PARA = "\uE000";
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/\n{2,}/g, PARA)
    .replace(/[ \t]*\n[ \t]*/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\uE000/g, "\n\n")
    .replace(/[ \t]+([，。；：、！？）】》])/g, "$1")
    .replace(/^[，。；：、！？）】》\s]+/, "")
    .trim();
}
