/**
 * 假模型服务：模拟 OpenAI 兼容 /v1/chat/completions 的 SSE 流式返回。
 * 用途：在拿不到真实模型 Key 时，端到端验证 /api/chat 的
 *       verdict / text / card 三段解析与 SSE 事件是否正确。
 *
 * 启动：node scripts/mock-model.mjs 3731
 */
import http from "node:http";

const port = Number(process.argv[2] || 3731);

// 依次吐出：判定块 → 讲解文本 → 数据补充卡（模拟"发现学生缺条件"的场景）
const REPLY = [
  "```verdict\n",
  '{"correct":false,"reason":"还缺截面尺寸和材料强度，先补齐才能判断","topic":"K5"}\n',
  "```\n\n",
  "先别急着算。要判断这个截面是否超筋，我们得先知道三件事：\n",
  "一是截面尺寸 $b \\\\times h$，二是混凝土强度等级，三是受拉钢筋面积 $A_s$。\n",
  "你把这几个数告诉我，我们再往下走。\n\n",
  "```card\n",
  '{"kind":"data","prompt":"请先补齐这道题的已知条件","fields":[{"key":"b","label":"截面宽度 b","unit":"mm"},{"key":"h","label":"截面高度 h","unit":"mm"},{"key":"fc","label":"混凝土强度等级","unit":"如 C30"},{"key":"As","label":"受拉钢筋面积 As","unit":"mm²"}],"hint":"题目图里通常会标截面尺寸，材料强度看题干","topic":"K5"}\n',
  "```\n",
];

const server = http.createServer((req, res) => {
  if (!req.url?.includes("/chat/completions")) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  let i = 0;
  const timer = setInterval(() => {
    if (i >= REPLY.length) {
      clearInterval(timer);
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    const piece = REPLY[i++];
    res.write(
      `data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`,
    );
  }, 12);
  req.on("close", () => clearInterval(timer));
});

server.listen(port, () => console.log(`mock model on http://127.0.0.1:${port}/v1`));
