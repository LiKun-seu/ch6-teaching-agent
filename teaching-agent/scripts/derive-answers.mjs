/**
 * 题库答案推导（两轮）
 *  第 1 轮：基于第六章知识库逐题给出答案 + 解析 + 置信度
 *  第 2 轮：不带解析独立再答一遍，与第 1 轮比对，一致才标 verified
 * 用法：node scripts/derive-answers.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const KEY = (await fs.readFile(path.join(ROOT, ".env.local"), "utf8"))
  .split("\n")
  .find((l) => l.startsWith("STEPFUN_API_KEY="))
  ?.slice("STEPFUN_API_KEY=".length)
  .trim();
const BASE = "https://api.stepfun.com/v1";
const MODEL = "step-3.5-flash";

if (!KEY) throw new Error("缺少 STEPFUN_API_KEY");

const questions = JSON.parse(
  await fs.readFile(path.join(ROOT, "src/content/questions.json"), "utf8"),
);
const knowledge = await fs.readFile(path.join(ROOT, "src/content/ch6-knowledge.md"), "utf8");

const TYPE_RULE = {
  choice: '选择题：answer 只填一个选项字母 A/B/C/D',
  judge: '判断题：answer 填 "T"（说法正确）或 "F"（说法错误）',
  fill: '填空题：answer 填应填入的内容，多个空用「；」分隔',
};

async function call(messages, maxTokens = 4096) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: MODEL, stream: false, temperature: 0.2, max_tokens: maxTokens, messages }),
  });
  if (!res.ok) throw new Error(`模型调用失败 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  return String(json?.choices?.[0]?.message?.content ?? "");
}

function parseJsonArray(text) {
  let s = text.trim();
  s = s.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const a = s.indexOf("[");
  const b = s.lastIndexOf("]");
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

const BATCH = 8;
const batches = [];
for (let i = 0; i < questions.length; i += BATCH) batches.push(questions.slice(i, i + BATCH));

function fmt(qs) {
  return qs
    .map((q) => {
      const opts = q.options?.length
        ? "\n" + q.options.map((o) => `  ${o.id}. ${o.text}`).join("\n")
        : "";
      return `[${q.id}]（${q.type}）${q.prompt}${opts}`;
    })
    .join("\n\n");
}

// ---------- 第 1 轮：答案 + 解析 ----------
const pass1 = new Map();
for (let i = 0; i < batches.length; i++) {
  const b = batches[i];
  const sys =
    "你是《混凝土结构设计》课程助教，为第六章题库制定标准答案。\n" +
    "判定依据优先级：① 下面给出的第六章知识库；② GB 50010 体系下的通行结论。\n" +
    "规则：\n" +
    "1. " + TYPE_RULE.choice + "；" + TYPE_RULE.judge + "；" + TYPE_RULE.fill + "。\n" +
    "2. analysis：一句话解析（不超过 40 字），写明依据的公式或概念。\n" +
    "3. confidence：high（知识库有直接依据）/ mid（规范常识可判）/ low（不确定）。\n" +
    "4. 只输出 JSON 数组，不要任何多余文字、不要代码块围栏。\n" +
    '输出格式：[{"id":"SC-01","answer":"C","analysis":"…","confidence":"high"}]';
  const user = `【第六章知识库】\n${knowledge}\n\n【题目】\n${fmt(b)}`;
  try {
    const out = await call([
      { role: "system", content: sys },
      { role: "user", content: user },
    ]);
    for (const r of parseJsonArray(out)) {
      if (r?.id) pass1.set(String(r.id), r);
    }
    console.log(`[1/2] 批次 ${i + 1}/${batches.length} 完成（${b[0].id}~${b[b.length - 1].id}），累计 ${pass1.size}`);
  } catch (e) {
    console.log(`[1/2] 批次 ${i + 1} 失败：${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 1200));
}

// ---------- 第 2 轮：独立复核 ----------
const pass2 = new Map();
for (let i = 0; i < batches.length; i++) {
  const b = batches[i];
  const sys =
    "你是混凝土结构设计的阅卷老师。只依据第六章知识库与规范常识，独立给出每题答案，不要解释。\n" +
    TYPE_RULE.choice + "；" + TYPE_RULE.judge + "；" + TYPE_RULE.fill + "。\n" +
    '只输出 JSON 数组：[{"id":"SC-01","answer":"C"}]';
  const user = `【第六章知识库】\n${knowledge}\n\n【题目】\n${fmt(b)}`;
  try {
    const out = await call(
      [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      2048,
    );
    for (const r of parseJsonArray(out)) {
      if (r?.id) pass2.set(String(r.id), String(r.answer ?? "").trim());
    }
    console.log(`[2/2] 复核批次 ${i + 1}/${batches.length} 完成，累计 ${pass2.size}`);
  } catch (e) {
    console.log(`[2/2] 批次 ${i + 1} 失败：${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 1200));
}

// ---------- 合并 ----------
const norm = (s) => String(s ?? "").trim().toUpperCase().replace(/[．.、）)]+$/, "");
let verified = 0;
let conflict = 0;
for (const q of questions) {
  const a = pass1.get(q.id);
  const b = pass2.get(q.id);
  if (a) {
    q.answer = String(a.answer ?? "").trim();
    q.analysis = String(a.analysis ?? "").trim();
    q.confidence = String(a.confidence ?? "low");
  }
  if (a && b) {
    const same = norm(a.answer) === norm(b);
    q.verified = same;
    if (same) verified++;
    else {
      conflict++;
      q.reviewAnswer = b;
    }
  } else {
    q.verified = false;
  }
}

await fs.writeFile(
  path.join(ROOT, "src/content/questions.json"),
  JSON.stringify(questions, null, 1),
  "utf8",
);

const noAnswer = questions.filter((q) => !q.answer).map((q) => q.id);
console.log("\n===== 完成 =====");
console.log(`总题数 ${questions.length}`);
console.log(`两轮一致（已复核） ${verified}`);
console.log(`两轮冲突（需人工看） ${conflict}${conflict ? "：" + questions.filter((q) => q.verified === false && q.answer).map((q) => q.id).join(",") : ""}`);
console.log(`未拿到答案 ${noAnswer.length}${noAnswer.length ? "：" + noAnswer.join(",") : ""}`);
