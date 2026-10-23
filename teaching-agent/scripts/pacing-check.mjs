/**
 * 节奏校验：验证"不再题海轰炸"（需求 5）
 *  - 讲解类提问：不应该弹卡片
 *  - 求解类任务：卡片数应收敛（≤ 3 张），且走到关键结论要有阶段性小结
 * 用法：node scripts/pacing-check.mjs [baseUrl]
 */
const BASE = process.argv[2] || "http://127.0.0.1:3000";

async function turn(messages) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  const events = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const p of parts) {
      for (const line of p.split("\n")) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const d = t.slice(5).trim();
        if (!d) continue;
        try {
          const ev = JSON.parse(d);
          events.push(ev);
          if (ev.type === "text") text += ev.delta;
        } catch {
          // 忽略
        }
      }
    }
  }
  const cards = events.filter((e) => e.type === "card");
  const figures = events.filter((e) => e.type === "figure");
  const verdicts = events.filter((e) => e.type === "verdict");
  return { text, cards, figures, verdicts };
}

const cardLine = (c) => `${c.kind}${c.topic ? "·" + c.topic : ""}${c.figure ? "·附图" : ""}`;

async function talk(label, script) {
  console.log(`\n══ ${label} ══`);
  const messages = [];
  let cardTotal = 0;
  for (let i = 0; i < script.length; i++) {
    const step = script[i];
    messages.push({ role: "user", content: step.user });
    const r = await turn(messages);
    cardTotal += r.cards.length;
    console.log(
      `第 ${i + 1} 轮｜卡片 ${r.cards.length} 张${r.cards.length ? "（" + r.cards.map((c) => cardLine(c.card ?? c)).join(" ") + "）" : ""}｜附图 ${r.figures.length}｜判定 ${r.verdicts.length ? (r.verdicts[0].correct ? "对" : "错") : "-"}`,
    );
    console.log(`   ${r.text.replace(/\s+/g, " ").slice(0, 150)}`);
    // 把助手这一轮的产出回写进历史（与前端一致）
    const assistant = r.text;
    const card = r.cards[0];
    messages.push({
      role: "assistant",
      content: card
        ? `${assistant}\n\n[我上一轮给出的卡片] ${JSON.stringify(card.card ?? card)}`
        : assistant,
    });
    if (step.then) messages.push({ role: "user", content: step.then });
  }
  return cardTotal;
}

function asksToPractice(text) {
  return /要不要|练练手|想不想做|要不要做题|要不要试试/.test(text);
}

// 场景 A：讲解 → 只发资料，0 张卡片，不问要不要做题
const resA = await (async () => {
  console.log("\n══ A. 讲解（期望 0 张卡片，并带上课件） ══");
  const r = await turn([{ role: "user", content: "给我讲讲双筋截面为什么要配置受压钢筋，我不太理解" }]);
  console.log(`第 1 轮｜卡片 ${r.cards.length}｜附图 ${r.figures.length}｜邀做题 ${asksToPractice(r.text) ? "有" : "无"}`);
  console.log(`   ${r.text.replace(/\s+/g, " ").slice(0, 180)}`);
  return r;
})();

// 场景 A2：讲完后学生接一句 → 直接出一张题，不再征求同意
const resA2 = await (async () => {
  console.log("\n══ A2. 讲完后学生说听懂了（期望直接 1 张卡片） ══");
  const r = await turn([
    { role: "user", content: "给我讲讲双筋截面为什么要配置受压钢筋" },
    {
      role: "assistant",
      content: "双筋是在受压区也放钢筋，用来接住单筋放不下的压力。\n\n```slides\n76-88\n```",
    },
    { role: "user", content: "听懂了" },
  ]);
  console.log(`第 2 轮｜卡片 ${r.cards.length}｜附图 ${r.figures.length}｜邀做题 ${asksToPractice(r.text) ? "有" : "无"}`);
  console.log(`   ${r.text.replace(/\s+/g, " ").slice(0, 180)}`);
  return r;
})();

/**
 * 场景 B：求解类 —— 卡片驱动的多轮。
 * 每轮根据上一轮真实拿到的卡片作答（不再硬编码），跑满 5 轮或模型不再出卡为止。
 */
async function solveRuns(label, firstQuestion, maxTurns = 5) {
  console.log(`\n══ ${label} ══`);
  const messages = [{ role: "user", content: firstQuestion }];
  let cardTotal = 0;
  for (let i = 0; i < maxTurns; i++) {
    const r = await turn(messages);
    cardTotal += r.cards.length;
    const card = r.cards[0]?.card ?? r.cards[0];
    console.log(
      `第 ${i + 1} 轮｜卡片 ${r.cards.length} 张${card ? "（" + cardLine(card) + "）" : ""}｜附图 ${r.figures.length}｜判定 ${r.verdicts.length ? (r.verdicts[0].correct ? "对" : "错") : "-"}`,
    );
    console.log(`   ${r.text.replace(/\s+/g, " ").slice(0, 200)}`);

    messages.push({
      role: "assistant",
      content: card
        ? `${r.text}\n\n[我上一轮给出的卡片] ${JSON.stringify(card)}`
        : r.text,
    });

    if (!card) {
      console.log("   （本轮没有卡片，对话自然收尾）");
      break;
    }
    messages.push({ role: "user", content: autoAnswer(card) });
  }
  console.log(`→ 共出卡片 ${cardTotal} 张`);
  return cardTotal;
}

/** 按卡片类型自动作答，模拟一个认真但偶尔答错的学生 */
function autoAnswer(card) {
  if (card.kind === "choice") {
    const ids = card.options.map((o) => o.id);
    return `我的选择是：${ids[Math.floor(Math.random() * ids.length)]}`;
  }
  if (card.kind === "truefalse") return "我的判断是：正确（√）";
  const values = card.fields
    .map((f) => `${f.label} = ${guessValue(f)}`)
    .join("；");
  return `我填写的数据：${values}`;
}

function guessValue(f) {
  const s = `${f.key} ${f.label}`.toLowerCase();
  if (/h0|有效高度/.test(s)) return "460";
  if (/fc|抗压/.test(s)) return "14.3";
  if (/fy|抗拉|屈服/.test(s)) return "360";
  if (/as|面积/.test(s)) return "942";
  if (/ξb|相对受压|界限/.test(s)) return "0.518";
  if (/x|受压区高度/.test(s)) return "108";
  if (/mu|弯矩|承载力/.test(s)) return "150";
  return "1.0";
}

console.log("\n══ B. 求解题第一轮应先发资料 ══");
const firstSolve = await turn([
  {
    role: "user",
    content: "某矩形截面梁 b=250mm，h=500mm，C30，HRB400，受拉钢筋 3φ20，M=150kN·m，帮我判断会不会超筋",
  },
]);
console.log(
  `第 1 轮｜卡片 ${firstSolve.cards.length}｜附图 ${firstSolve.figures.length}｜邀做题 ${asksToPractice(firstSolve.text) ? "有" : "无"}`,
);
console.log(`   ${firstSolve.text.replace(/\s+/g, " ").slice(0, 180)}`);

console.log("\n══ B2. 资料已经发过，学生说继续（应直接出卡，累计 1~3） ══");
const taught = [
  {
    role: "user",
    content: "某矩形截面梁 b=250mm，h=500mm，C30，HRB400，受拉钢筋 3φ20，M=150kN·m，帮我判断会不会超筋",
  },
  {
    role: "assistant",
    content: "判断超筋就是比较实际受压区高度 x 和界限高度 xb。单筋矩形这一节的课件先看一下。",
  },
  { role: "user", content: "听懂了，继续判断这道题" },
];
let cardsB = 0;
for (let i = 0; i < 4; i++) {
  const r = await turn(taught);
  cardsB += r.cards.length;
  const card = r.cards[0]?.card ?? r.cards[0];
  console.log(`第 ${i + 2} 轮｜卡片 ${r.cards.length}${card ? "（" + cardLine(card) + "）" : ""}｜附图 ${r.figures.length}`);
  console.log(`   ${r.text.replace(/\s+/g, " ").slice(0, 160)}`);
  taught.push({
    role: "assistant",
    content: card ? `${r.text}\n\n[我上一轮给出的卡片] ${JSON.stringify(card)}` : r.text,
  });
  if (!card) break;
  taught.push({ role: "user", content: autoAnswer(card) });
}

console.log("\n══ 结论 ══");
const aOk = resA.cards.length === 0 && resA.figures.length > 0 && !asksToPractice(resA.text);
const a2Ok = resA2.cards.length === 1 && !asksToPractice(resA2.text);
const b1Ok = firstSolve.cards.length === 0 && firstSolve.figures.length > 0 && !asksToPractice(firstSolve.text);
const b2Ok = cardsB >= 1 && cardsB <= 3;
if (!aOk || !a2Ok || !b1Ok || !b2Ok) process.exitCode = 1;
console.log(`A 讲解先发资料且不出卡 ${aOk ? "✓" : "✗"}（卡片 ${resA.cards.length}，附图 ${resA.figures.length}）`);
console.log(`A2 讲完直接出题 ${a2Ok ? "✓" : "✗"}（卡片 ${resA2.cards.length}）`);
console.log(`B 求解第一轮只发资料 ${b1Ok ? "✓" : "✗"}（卡片 ${firstSolve.cards.length}，附图 ${firstSolve.figures.length}）`);
console.log(`B2 之后做题卡片数 ${cardsB}（期望 1~3） ${b2Ok ? "✓" : "✗"}`);
