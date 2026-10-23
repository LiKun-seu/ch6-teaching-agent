/**
 * 端到端校验：跑几个典型场景，检查流式事件是否符合协议
 * 用法：node scripts/e2e-check.mjs [baseUrl]
 */
const BASE = process.argv[2] || "http://127.0.0.1:3000";

const CASES = [
  {
    name: "① 求解题第一轮（先发资料，不出卡片）",
    messages: [
      { role: "user", content: "某矩形截面梁 b=250mm，h=500mm，受拉钢筋 3φ20，M=150kN·m，帮我判断会不会超筋？" },
    ],
    expect: ["figure"],
    forbid: ["card"],
  },
  {
    name: "② 概念讲解（应出流程图或 PPT 图，且不要题海）",
    messages: [{ role: "user", content: "给我讲讲单筋矩形截面正截面受弯承载力的计算步骤" }],
    expect: ["figure"],
  },
  {
    name: "③ 学生作答后的判定闭环",
    messages: [
      { role: "user", content: "帮我判断这个梁会不会超筋：b=250，h=500，C30，HRB400，3φ20，M=150kN·m" },
      {
        role: "assistant",
        content: "先确认有效高度。\n\n[我上一轮给出的卡片] {\"kind\":\"choice\",\"prompt\":\"单排布置受拉钢筋时 as 近似取多少？\",\"options\":[{\"id\":\"A\",\"text\":\"20mm\"},{\"id\":\"B\",\"text\":\"40mm\"},{\"id\":\"C\",\"text\":\"65mm\"},{\"id\":\"D\",\"text\":\"80mm\"}],\"topic\":\"K5\"}",
      },
      { role: "user", content: "我的选择是：B（40mm）" },
    ],
    expect: ["verdict"],
  },
  {
    name: "④ 让学生看 PPT 某一页",
    messages: [{ role: "user", content: "T 形截面第一类第二类怎么判别？把课件那一页也给我看看" }],
    expect: ["figure"],
  },
];

async function run(c) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: c.messages }),
  });
  if (!res.ok || !res.body) {
    console.log(`✗ ${c.name} → HTTP ${res.status}`);
    process.exitCode = 1;
    return;
  }
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
  const kinds = [...new Set(events.map((e) => e.type))];
  const ok =
    c.expect.every((k) => kinds.includes(k)) &&
    !(c.forbid || []).some((k) => kinds.includes(k));
  if (!ok || events.some(event => event.type === "error")) process.exitCode = 1;
  const verdict = events.find((e) => e.type === "verdict");
  const card = events.find((e) => e.type === "card");
  const figs = events.filter((e) => e.type === "figure");
  console.log(`\n${ok ? "✓" : "△"} ${c.name}`);
  console.log(`  耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s | 事件：${kinds.join(",")}`);
  if (verdict) console.log(`  判定：${verdict.correct ? "对" : "错"}·${verdict.topic ?? "-"}·${(verdict.reason ?? "").slice(0, 40)}`);
  if (card) console.log(`  卡片：${card.card.kind}${card.card.topic ? " · " + card.card.topic : ""}${card.card.figure ? " · 附图:" + card.card.figure.kind : ""}`);
  for (const f of figs) {
    const fig = f.figure || {};
    const detail =
      fig.kind === "slide"
        ? ` 第${fig.page}页`
        : fig.kind === "slides"
          ? ` ${fig.pages?.[0]}-${fig.pages?.[fig.pages.length - 1]} 共${fig.pages?.length}页`
          : ` ${(fig.html || "").length} 字节 HTML`;
    console.log(`  附图：${fig.kind}${detail}`);
  }
  console.log(`  正文（前 160 字）：${text.replace(/\s+/g, " ").slice(0, 160)}`);
}

for (const c of CASES) {
  try {
    await run(c);
  } catch (e) {
    console.log(`✗ ${c.name} → ${e?.message || e}`);
    process.exitCode = 1;
  }
}
