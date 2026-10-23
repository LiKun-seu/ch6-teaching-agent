/**
 * 用截图里的坏公式过一遍 Markdown 预处理 + KaTeX，确认 \text 不再以源码出现。
 * 运行：npm run test:math
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { prepareMathMarkdown, rehypeDemoteKatexErrors } from "../src/lib/math-markdown.ts";

const shot = `例如，如果板上作用的均布荷载是（ q = 2 ,
\\text{kN/m}^2 ），板的实际宽度是（ 6 , \\text{m} ），那么
在计算 ==1 米宽板带== 时，等效的线荷载就是（ q' = 2 ,
\\text{kN/m}^2 \\times 1 , \\text{m} = 2 , \\text{kN/m} ）。
（弯矩、剪力）就直接对应 ==1 米宽板带== 的受力。`;

function visible(html) {
  return html
    .replace(/<annotation[\s\S]*?<\/annotation>/gi, "")
    .replace(/<math[\s\S]*?<\/math>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function render(text) {
  const prepared = prepareMathMarkdown(text);
  const html = renderToStaticMarkup(
    React.createElement(ReactMarkdown, {
      remarkPlugins: [remarkMath, remarkGfm],
      rehypePlugins: [
        [rehypeKatex, { throwOnError: false, strict: false, output: "html" }],
        rehypeDemoteKatexErrors,
      ],
      children: prepared,
    }),
  );
  return { prepared, html, text: visible(html) };
}

const fails = [];
function check(name, ok, detail) {
  if (ok) {
    console.log("PASS", name);
    return;
  }
  fails.push(name);
  console.log("FAIL", name);
  if (detail) console.log(detail);
}

const shotHtml = render(shot);
check(
  "截图公式不再露出 \\text / \\times",
  !shotHtml.text.includes("\\text") && !shotHtml.text.includes("\\times") && !shotHtml.text.includes("kN/m}^2"),
  shotHtml.text,
);
check("截图公式走了 KaTeX", shotHtml.html.includes("katex"), shotHtml.html.slice(0, 400));
check("截图里还能看到单位 kN/m", shotHtml.text.includes("kN/m"), shotHtml.text);
check(
  "黄色高亮没有包进公式",
  ![...shotHtml.html.matchAll(/<mark\b[^>]*>[\s\S]*?<\/mark>/g)].some((m) => m[0].includes("katex") || m[0].includes("\\text")),
  shotHtml.html,
);

const caretInside = render("荷载是（ \\text{kN/m^2} ），停。");
check(
  "\\text{kN/m^2} 上标被修好，源码不出现",
  caretInside.html.includes("katex") && !caretInside.text.includes("\\text") && /kN\/m/.test(caretInside.text),
  `prepared=${caretInside.prepared}\nvisible=${caretInside.text}`,
);

const spaced = render("（ q = 2 , \\text {kN/m} ^ 2 ）");
check(
  "多余空格仍能排成公式",
  spaced.html.includes("katex") && !spaced.text.includes("\\text"),
  `prepared=${spaced.prepared}\nvisible=${spaced.text}`,
);

const englishParen = render("宽度是 ( 6 , \\text{m} ) 没问题。");
check(
  "英文括号里的 LaTeX 也会排",
  englishParen.html.includes("katex") && !englishParen.text.includes("\\text"),
  englishParen.text,
);

const already = render("已经包好的 $q = \\text{kN/m}^2$ 继续。");
check(
  "原有 $...$ 仍走 KaTeX",
  already.html.includes("katex") && !already.text.includes("\\text"),
  already.text,
);

const stream = "弯矩 $M = f_y 所以后面整段正文不要进公式，包括第二句。";
const streamOut = render(stream);
const streamMath = [...streamOut.prepared.matchAll(/\$([^$]+)\$/g)].map((m) => m[1]);
check(
  "未闭合 $ 不吞后面的正文",
  streamMath.length >= 1 && streamMath.every((body) => !body.includes("所以")) && streamOut.text.includes("所以后面整段正文"),
  `prepared=${streamOut.prepared}\nmath=${JSON.stringify(streamMath)}\nvisible=${streamOut.text}`,
);

const openEnd = prepareMathMarkdown("弯矩 $M = f_y");
check(
  "流式末尾的半截公式会先闭合",
  /\$[^$]*f_\{?y\}?[^$]*\$/.test(openEnd) || /\$[^$]*f_y[^$]*\$/.test(openEnd),
  openEnd,
);

const overlap = render("这叫==单位（ \\text{m} ）==，继续。");
check(
  "高亮叠在公式上时不切进公式",
  overlap.html.includes("katex") &&
    ![...overlap.html.matchAll(/<mark\b[^>]*>[\s\S]*?<\/mark>/g)].some((m) => m[0].includes("katex")),
  `prepared=${overlap.prepared}\n${overlap.html}`,
);

const broken = render("写了个 \\foobar{abc} 在句子里。");
check(
  "修不好的命令降级成可读文字，不留反斜杠",
  !broken.text.includes("\\") && !broken.html.includes("katex-error"),
  `prepared=${broken.prepared}\nvisible=${broken.text}`,
);

const display = render("独立公式\n$$\\frac{M}{W}$$\n讲完。");
check("$$...$$ 仍能排", display.html.includes("katex") && !display.text.includes("\\frac"), display.text);

const sc52 = render(
  "受弯构件发生适筋破坏时，受拉钢筋应变 ε_s [推断1] 和受压边缘混凝土应变 ε_c [推断2] 分别为(  　)。 - *注：受拉钢筋应变 ε_s 与受压边缘混凝土应变 ε_c（选项四组为二者与 ε_y、ε_cu 的大小组合）*",
);
check(
  "SC-52 题干去掉推断标记，下标进公式",
  !sc52.text.includes("推断") &&
    !sc52.text.includes("注：") &&
    !sc52.prepared.includes("[推断") &&
    !sc52.prepared.includes("注：") &&
    sc52.html.includes("katex") &&
    !sc52.text.includes("ε_s") &&
    !sc52.text.includes("_s") &&
    !sc52.text.includes("_c"),
  `prepared=${sc52.prepared}\nvisible=${sc52.text}`,
);

const sc52opt = render("ε_s>ε_y，ε_c=ε_cu `[推断]`");
check(
  "SC-52 选项去掉反引号和推断标记，比较号在公式里",
  !sc52opt.text.includes("推断") &&
    !sc52opt.text.includes("`") &&
    !sc52opt.prepared.includes("`") &&
    sc52opt.html.includes("katex") &&
    !sc52opt.text.includes("_"),
  `prepared=${sc52opt.prepared}\nvisible=${sc52opt.text}`,
);

const implicit = render("εs>εy，εc=εcu");
check(
  "没有下划线的 εs 也排成下标",
  implicit.html.includes("msupsub") &&
    implicit.prepared.includes("\\varepsilon_{s}") &&
    implicit.prepared.includes("\\varepsilon_{cu}") &&
    !implicit.text.includes("_"),
  `prepared=${implicit.prepared}\nvisible=${implicit.text}`,
);

const lambda = render("对于无腹筋梁，当 **λ<1** `[推断]` 时，常发生斜压破坏。");
check(
  "剪跨比 λ<1 去掉推断标记并排成公式",
  !lambda.text.includes("推断") && lambda.html.includes("katex") && !lambda.prepared.includes("[推断"),
  `prepared=${lambda.prepared}\nvisible=${lambda.text}`,
);

const chain = render("2a_s′≤x≤ξ_b h₀");
check(
  "带撇号和 unicode 下标的不等式整段进公式",
  chain.html.includes("msupsub") &&
    chain.prepared.includes("a_{s}'") &&
    chain.prepared.includes("\\xi_{b}") &&
    chain.prepared.includes("h_{0}") &&
    !chain.text.includes("_"),
  `prepared=${chain.prepared}\nvisible=${chain.text}`,
);

const rho = render("当满足条件ρmin≤ρ≤ρmax时，ρ越大。");
check(
  "ρmin 这类紧挨着的下标会排",
  rho.html.includes("msupsub") &&
    rho.prepared.includes("\\rho_{min}") &&
    rho.prepared.includes("\\rho_{max}") &&
    !rho.text.includes("_"),
  `prepared=${rho.prepared}\nvisible=${rho.text}`,
);

const alpha = render("截面抵抗矩系数 α_s=ξ(1−0.5ξ)∈[0,0.5]");
check(
  "带括号和区间的公式不断成两截",
  alpha.prepared.includes("\\alpha_{s}=\\xi(1-0.5\\xi)\\in [0,0.5]") &&
    !alpha.prepared.includes("$$") &&
    alpha.html.includes("katex"),
  `prepared=${alpha.prepared}\nvisible=${alpha.text}`,
);

const keepGrade = render("混凝土强度等级不应低于C25，钢筋用HRB400。");
check(
  "混凝土等级和钢筋牌号不要被当成下标",
  keepGrade.text.includes("C25") && keepGrade.text.includes("HRB400") && !keepGrade.prepared.includes("$C"),
  `prepared=${keepGrade.prepared}\nvisible=${keepGrade.text}`,
);

const code = render("代码里的 `\\text{kN/m}^2` 保持原样，正文（ \\rho ）要排。");
check(
  "行内代码不改，旁边的 \\rho 要排",
  code.prepared.includes("`\\text{kN/m}^2`") && code.html.includes("katex") && !code.text.replace("\\text{kN/m}^2", "").includes("\\rho"),
  `prepared=${code.prepared}\nvisible=${code.text}`,
);

console.log("\n--- 截图可见文字 ---");
console.log(shotHtml.text.replace(/\s+/g, " ").trim());

if (fails.length) {
  console.error(`\n${fails.length} failed`);
  process.exit(1);
}
console.log("\nall passed");
