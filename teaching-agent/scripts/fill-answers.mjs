/**
 * 补齐答案：只对「没答案」或「未复核」的题重跑，冲突题做第三轮仲裁。
 * 用法：node scripts/fill-answers.mjs
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

const questions = JSON.parse(await fs.readFile(path.join(ROOT, "src/content/questions.json"), "utf8"));
const knowledge = await fs.readFile(path.join(ROOT, "src/content/ch6-knowledge.md"), "utf8");

const TYPE_RULE = {
  choice: "选择题：answer 只填一个选项字母 A/B/C/D",
  judge: '判断题：answer 填 "T"（说法正确）或 "F"（说法错误）',
  fill: '填空题：answer 填应填入的内容，多个空用「；」分隔',
};

async function call(messages, maxTokens = 4096) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ model: MODEL, stream: false, temperature: 0.2, max_tokens: maxTokens, messages }),
    });
    if (res.ok) {
      const json = await res.json();
      return String(json?.choices?.[0]?.message?.content ?? "");
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return "";
}

function parseJsonArray(text) {
  let s = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
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

const norm = (s) => String(s ?? "").trim().toUpperCase().replace(/[．.、）)]+$/, "");
const fmt = (qs) =>
  qs
    .map((q) => {
      const opts = q.options?.length ? "\n" + q.options.map((o) => `  ${o.id}. ${o.text}`).join("\n") : "";
      return `[${q.id}]（${q.type}）${q.prompt}${opts}`;
    })
    .join("\n\n");

// node scripts/fill-answers.mjs missing   → 只补完全没答案的题
const onlyMissing = process.argv[2] === "missing";
const targets = questions.filter((q) => (onlyMissing ? !q.answer : !q.answer || q.verified !== true));
console.log(`待补齐 ${targets.length} 题`);

const BATCH = Number(process.env.BATCH_SIZE || 4);
const batches = [];
for (let i = 0; i < targets.length; i += BATCH) batches.push(targets.slice(i, i + BATCH));

let fixed = 0;
for (let i = 0; i < batches.length; i++) {
  const b = batches[i];
  const body = fmt(b);

  const detailed = parseJsonArray(
    await call([
      {
        role: "system",
        content:
          "你是《混凝土结构设计》助教，为第六章题库定标准答案。依据：第六章知识库 + GB 50010 体系。\n" +
          TYPE_RULE.choice + "；" + TYPE_RULE.judge + "；" + TYPE_RULE.fill + "。\n" +
          "analysis 一句话（≤40 字）写依据；confidence 填 high/mid/low。\n" +
          '只输出 JSON 数组：[{"id":"SC-01","answer":"C","analysis":"…","confidence":"high"}]',
      },
      { role: "user", content: `【知识库】\n${knowledge}\n\n【题目】\n${body}` },
    ]),
  );
  const plain = parseJsonArray(
    await call(
      [
        {
          role: "system",
          content:
            "你是阅卷老师，独立给出每题答案，不要解释。\n" +
            TYPE_RULE.choice + "；" + TYPE_RULE.judge + "；" + TYPE_RULE.fill + "。\n" +
            '只输出 JSON 数组：[{"id":"SC-01","answer":"C"}]',
        },
        { role: "user", content: `【知识库】\n${knowledge}\n\n【题目】\n${body}` },
      ],
      2048,
    ),
  );

  const A = new Map(detailed.filter((x) => x?.id).map((x) => [String(x.id), x]));
  const B = new Map(plain.filter((x) => x?.id).map((x) => [String(x.id), String(x.answer ?? "").trim()]));

  for (const q of b) {
    const a = A.get(q.id);
    const bv = B.get(q.id);
    if (a && bv && norm(a.answer) === norm(bv)) {
      q.answer = String(a.answer).trim();
      q.analysis = String(a.analysis ?? "").trim();
      q.confidence = String(a.confidence ?? "mid");
      q.verified = true;
      fixed++;
      continue;
    }
    if (a && bv) {
      // 两轮冲突 → 第三轮仲裁
      const arb = await call([
        {
          role: "system",
          content:
            "你是混凝土结构设计教授，做最终裁定。下面给出一道题和两个互相矛盾的答案，请判断哪个正确，并给出最终答案。\n" +
            TYPE_RULE.choice + "；" + TYPE_RULE.judge + "；" + TYPE_RULE.fill + "。\n" +
            '只输出 JSON：{"answer":"…","analysis":"一句话依据","confidence":"high|mid|low"}',
        },
        {
          role: "user",
          content: `【知识库】\n${knowledge}\n\n【题目】\n${fmt([q])}\n\n【候选答案】候选1：${a.answer}；候选2：${bv}`,
        },
      ]);
      let s = arb.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      const x = s.indexOf("{");
      const y = s.lastIndexOf("}");
      if (x >= 0 && y > x) {
        try {
          const o = JSON.parse(s.slice(x, y + 1));
          q.answer = String(o.answer ?? a.answer).trim();
          q.analysis = String(o.analysis ?? a.analysis ?? "").trim();
          q.confidence = String(o.confidence ?? "mid");
          q.verified = false; // 仲裁结果仍标未复核，便于后续人工抽查
          q.reviewAnswer = bv;
          fixed++;
          continue;
        } catch {
          // fallthrough
        }
      }
    }
    if (a) {
      q.answer = String(a.answer).trim();
      q.analysis = String(a.analysis ?? "").trim();
      q.confidence = String(a.confidence ?? "low");
      q.verified = false;
      fixed++;
    } else if (bv) {
      q.answer = bv;
      q.verified = false;
      fixed++;
    }
  }

  console.log(`批次 ${i + 1}/${batches.length} 完成，已处理 ${fixed}`);
  await fs.writeFile(path.join(ROOT, "src/content/questions.json"), JSON.stringify(questions, null, 1), "utf8");
  await new Promise((r) => setTimeout(r, 1000));
}

const noAns = questions.filter((q) => !q.answer).map((q) => q.id);
const unver = questions.filter((q) => q.answer && q.verified !== true).map((q) => q.id);
console.log("\n===== 补齐完成 =====");
console.log(`有答案 ${questions.filter((q) => q.answer).length}/${questions.length}`);
console.log(`已复核 ${questions.filter((q) => q.verified === true).length}`);
console.log(`未复核 ${unver.length}${unver.length ? "：" + unver.join(",") : ""}`);
console.log(`仍无答案 ${noAns.length}${noAns.length ? "：" + noAns.join(",") : ""}`);
