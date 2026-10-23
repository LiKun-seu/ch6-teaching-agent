/**
 * 为 PPT 页面图生成干净的中文要点笔记
 *  读取 src/content/slides.json，逐页把图片（base64 data URL）+ section + 原 title 发给视觉模型，
 *  产出 { page: { title, points[], keys[] } } 写入 src/content/slide-notes.json。
 *  支持断点续跑：启动时跳过已存在的页；每页处理后立即增量落盘。
 * 用法：node scripts/gen-slide-notes.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SLIDES = path.join(ROOT, "src/content/slides.json");
const NOTES = path.join(ROOT, "src/content/slide-notes.json");
const IMG_DIR = path.join(ROOT, "public/slides");

const BASE = "https://api.stepfun.com/v1";
const MODEL = "step-1o-turbo-vision";

// ---------- 读取 key ----------
const KEY = (await fs.readFile(path.join(ROOT, ".env.local"), "utf8"))
  .split(/\r?\n/)
  .find((l) => l.startsWith("STEPFUN_API_KEY="))
  ?.slice("STEPFUN_API_KEY=".length)
  .trim();
if (!KEY) throw new Error("缺少 STEPFUN_API_KEY");

// ---------- 读取 slides ----------
const slides = JSON.parse(await fs.readFile(SLIDES, "utf8"));
console.log(`共 ${slides.length} 页幻灯片`);

// ---------- 读取已有笔记（断点续跑） ----------
let notes = {};
try {
  notes = JSON.parse(await fs.readFile(NOTES, "utf8"));
  console.log(`已存在笔记 ${Object.keys(notes).length} 页，将跳过`);
} catch {
  notes = {};
}

async function saveNotes() {
  // 按页码排序输出，便于人工查看
  const sorted = {};
  for (const k of Object.keys(notes).sort((a, b) => Number(a) - Number(b))) sorted[k] = notes[k];
  await fs.writeFile(NOTES, JSON.stringify(sorted, null, 1), "utf8");
}

// ---------- 图片转 data URL ----------
async function toDataUrl(file) {
  const buf = await fs.readFile(file);
  return `data:image/png;base64,${buf.toString("base64")}`;
}

const SYSTEM =
  "你是《混凝土结构设计》课程（GB 50010-2002 体系）的助教，负责把课件某一页整理成干净、通顺的中文学习笔记。\n" +
  "只输出一个 JSON 对象，不要任何多余文字、不要代码块围栏。格式：\n" +
  '{"title":"本页中文标题","points":["要点1","要点2"],"keys":["关键词1","关键词2"]}\n' +
  "规则：\n" +
  "1. title：用一句通顺的中文概括本页主题（可为章节小节名，如「6.5 单筋矩形截面的计算」）。\n" +
  "2. points：3~6 条完整、通顺的中文要点句，是老师讲的知识点，不是 OCR 碎片；每条尽量一到两句话，不要照抄整页公式堆砌。\n" +
  "   - 数学公式一律写成 LaTeX，且**行内必须用 $...$、独立公式必须用 $$...$$**；严禁使用 \\(...\\) 或 \\[...\\] 这种定界符。\n" +
  "     例如 $ \\alpha_1 f_c b x = f_y A_s $、$ M_u = \\alpha_1 f_c b x (h_0 - x/2) $。\n" +
  "   - 只使用 KaTeX 能渲染的标准命令（\\alpha、\\frac、\\xi、\\leq 等），禁止使用除标准环境外的奇怪 \\begin{} 环境。\n" +
  "   - 若本页只有图或表格，就用中文说明这张图/表在表达什么（受力、破坏形态、截面构造、关系曲线等）。\n" +
  "   - 若本页是封面/目录/致谢，points 给 1 条说明即可。\n" +
  "3. keys：本页 2~5 个需要重点高亮的中文术语或符号，如 $\\xi_b$、界限相对受压区高度、最小配筋率、适筋破坏。\n" +
  "4. 输出必须是合法 JSON：字符串里**不要出现英文双引号**（如需引号请用中文「」），反斜杠等特殊字符按 JSON 规则转义。";

function userText(slide, hasOcr, attempt) {
  const strict =
    attempt > 1
      ? "\n（注意：上一次输出无法被解析。请务必只输出一个合法的 JSON 对象：不要代码块围栏、字符串内不要出现英文双引号、反斜杠按 JSON 规则转义。）"
      : "";
  return (
    `本页基本信息：\n` +
    `- 页码：第 ${slide.page} 页\n` +
    `- 章节：${slide.section}\n` +
    (hasOcr ? `- 课件抽取的原始标题（可能含 OCR 误差，仅作参考）：${slide.title}\n` : "") +
    `\n请仔细阅读所附的课件页面图片，按系统要求输出该页笔记的 JSON。` +
    strict
  );
}

async function callModel(slide, dataUrl, attempt = 1) {
  const hasOcr = Boolean(slide.title && slide.title.trim());
  const body = {
    model: MODEL,
    stream: false,
    temperature: 0.2,
    max_tokens: 1500,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: dataUrl } },
          { type: "text", text: userText(slide, hasOcr, attempt) },
        ],
      },
    ],
  };
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  return String(json?.choices?.[0]?.message?.content ?? "");
}

// 模型经常把 LaTeX 里的单个反斜杠直接写进 JSON 字符串（如 \frac、\xi、\alpha），
// 这些要么是非法转义（\a \x \l…）导致解析失败，要么被误当作 \f \t \b 等控制符而破坏公式。
// 这里逐字符修复：保留 \\ \" \/ 与真正的换行/制表转义，其余单个反斜杠一律补成 \\。
function repairBackslashes(s) {
  const KEEP = new Set(["b", "f", "n", "r", "t"]);
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = s[i + 1];
    if (next === undefined) {
      out += "\\\\";
      continue;
    }
    if (next === "\\") {
      out += "\\\\";
      i++;
      continue;
    }
    if (next === '"' || next === "/") {
      out += "\\" + next;
      i++;
      continue;
    }
    // \n \t 等：仅当后面不是字母时才认定为真正的转义（换行/制表），否则视为 LaTeX（\nu、\times）
    if (KEEP.has(next) && !/[A-Za-z]/.test(s[i + 2] ?? "")) {
      out += "\\" + next;
      i++;
      continue;
    }
    out += "\\\\";
  }
  return out;
}

// ---------- 解析模型输出为 {title, points, keys} ----------
// 把 \(...\) / \[...\] 统一成 $...$ / $$...$$，保证 KaTeX 前端可渲染
function normalizeMath(s) {
  return s
    .replace(/\\\[([\s\S]*?)\\\]/g, (_m, x) => `$$${x}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_m, x) => `$${x}$`);
}

// 宽松兜底：JSON 解析彻底失败时，用正则把 title / points / keys 抠出来
function lenientExtract(s) {
  const pickStr = (re) => {
    const m = s.match(re);
    return m ? m[1] : "";
  };
  const title = pickStr(/"title"\s*:\s*"([\s\S]*?)"\s*[,}]/).trim();
  const grabArray = (name) => {
    const m = s.match(new RegExp(`"${name}"\\s*:\\s*\\[([\\s\\S]*?)\\]`));
    if (!m) return [];
    const items = [];
    for (const q of m[1].matchAll(/"((?:\\.|[^"\\])*)"/g)) items.push(q[1]);
    return items.map((x) => x.trim()).filter(Boolean);
  };
  return { title, points: grabArray("points"), keys: grabArray("keys") };
}

function parseNote(text) {
  let s = text.trim();
  s = s.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a >= 0 && b > a) s = s.slice(a, b + 1);

  let obj = null;
  const attempts = [
    () => JSON.parse(repairBackslashes(s)),
    // 兜底：去掉字符串里可能出现的裸控制字符（裸换行等）后再修反斜杠
    () => JSON.parse(repairBackslashes(s.replace(/[\u0000-\u001f]/g, " "))),
    () => JSON.parse(s),
    () => lenientExtract(s),
  ];
  let lastErr;
  for (const fn of attempts) {
    try {
      const v = fn();
      if (v && v.title) {
        obj = v;
        break;
      }
      lastErr = new Error("字段缺失");
    } catch (e) {
      lastErr = e;
    }
  }
  if (!obj) throw lastErr ?? new Error("解析失败");

  const title = String(obj?.title ?? "").trim();
  const points = Array.isArray(obj?.points)
    ? obj.points.map((p) => normalizeMath(String(p).trim())).filter(Boolean)
    : [];
  const keys = Array.isArray(obj?.keys)
    ? obj.keys.map((k) => normalizeMath(String(k).trim())).filter(Boolean)
    : [];
  if (!title || points.length === 0) throw new Error("字段缺失");
  return { title, points, keys };
}

// ---------- 主循环 ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failed = [];
let done = 0;
let total = 0;
for (const s of slides) if (notes[String(s.page)]) done++;

for (let i = 0; i < slides.length; i++) {
  const slide = slides[i];
  const key = String(slide.page);
  if (notes[key]) continue;
  total++;

  const file = path.join(IMG_DIR, `slide-${String(slide.page).padStart(3, "0")}.png`);
  let dataUrl;
  try {
    dataUrl = await toDataUrl(file);
  } catch (e) {
    console.log(`第 ${slide.page} 页：读图失败 ${e.message}`);
    failed.push(slide.page);
    continue;
  }

  let note = null;
  for (let attempt = 1; attempt <= 3 && !note; attempt++) {
    try {
      const out = await callModel(slide, dataUrl, attempt);
      note = parseNote(out);
    } catch (e) {
      console.log(`第 ${slide.page} 页：第 ${attempt} 次失败 ${e.message}`);
      if (attempt < 3) await sleep(1000);
    }
  }

  if (!note) {
    failed.push(slide.page);
    done++;
    continue;
  }

  notes[key] = note;
  await saveNotes();
  done++;
  if (done % 10 === 0 || done === slides.length) {
    console.log(`进度 ${done}/${slides.length}（本页 ${slide.page}：${note.title}）`);
  }
  await sleep(500);
}

console.log("\n===== 完成 =====");
console.log(`成功页数 ${Object.keys(notes).length}/${slides.length}`);
console.log(`本轮新处理 ${total} 页`);
if (failed.length) console.log(`失败页号 ${failed.join(", ")}`);
else console.log("失败页号 无");
