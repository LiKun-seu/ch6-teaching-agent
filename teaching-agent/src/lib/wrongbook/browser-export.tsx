"use client";
import { Markdown } from "@/components/Markdown";

export function downloadMarkdown(markdown: string, filename: string) {
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/** 与笔记导出共用 Markdown/KaTeX 和浏览器打印机制，不请求模型。 */
export async function printWrongbook(markdown: string, filename: string) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) throw new Error("浏览器拦住了打印窗口，请允许弹出窗口后重试");
  printWindow.document.body.textContent = "正在准备打印…";
  let preparationTimeout: number | undefined;
  let closedWindowCheck: number | undefined;
  try {
    const styles = [...document.querySelectorAll('link[rel="stylesheet"], style')].map(element => {
      const clone = element.cloneNode(true) as HTMLElement;
      if (clone instanceof HTMLLinkElement) clone.href = (element as HTMLLinkElement).href;
      return clone.outerHTML;
    }).join("");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const body = renderToStaticMarkup(<Markdown text={markdown} />);
    const title = filename.replace(/[<>&"']/g, "").replace(/\.md$/, "");
    printWindow.document.open();
    // document.open() clears the window's listeners, so install this afterwards.
    const loaded = new Promise<void>(resolve => printWindow.addEventListener("load", () => resolve(), { once: true }));
    const preparationStopped = new Promise<never>((_, reject) => {
      preparationTimeout = window.setTimeout(() => reject(new Error("打印窗口加载超时，请检查网络后重新打印")), 30_000);
      closedWindowCheck = window.setInterval(() => {
        if (printWindow.closed) reject(new Error("打印窗口已关闭，请重新打印"));
      }, 250);
    });
    printWindow.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title>${styles}<style>
      @page{size:A4;margin:18mm}body{font-family:"Microsoft YaHei",sans-serif;max-width:760px;margin:24px auto;padding:16px;background:white;color:#1a1a18;line-height:1.8}
      h1{font-size:22px}h2{font-size:17px;break-after:avoid;page-break-after:avoid;margin-top:24px}.md-body{font-size:14px;overflow-wrap:anywhere}
      img{max-width:100%;height:auto;break-inside:avoid}li{break-inside:avoid}p{orphans:3;widows:3}.katex{color:inherit}
      .katex-display{max-width:100%;overflow-x:auto;overflow-y:hidden;padding:4px 0}.katex-display>.katex{white-space:normal;overflow-wrap:anywhere}
      @media print{body{margin:0;padding:0;max-width:none}.katex-display{overflow:visible}a{color:inherit}}
      </style></head><body>${body}</body></html>`);
    printWindow.document.close();
    await Promise.race([(async () => {
      await loaded;
      await printWindow.document.fonts.ready;
      await Promise.allSettled([...printWindow.document.images].map(image => image.decode()));
    })(), preparationStopped]);
    for (const formula of printWindow.document.querySelectorAll<HTMLElement>(".katex-display > .katex")) {
      const availableWidth = formula.parentElement!.clientWidth;
      const width = formula.scrollWidth;
      if (width > availableWidth && availableWidth > 0) formula.style.fontSize = `${parseFloat(printWindow.getComputedStyle(formula).fontSize) * availableWidth / width}px`;
    }
    if (printWindow.closed) throw new Error("打印窗口已关闭，请重新打印");
    printWindow.focus(); printWindow.print();
  } catch (error) { if (!printWindow.closed) printWindow.close(); throw error; }
  finally { window.clearTimeout(preparationTimeout); window.clearInterval(closedWindowCheck); }
}
