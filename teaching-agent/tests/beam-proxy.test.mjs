import test from "node:test";
import assert from "node:assert/strict";
import { beamProxy, beamHealth } from "../src/lib/beam-service.ts";

const input = { b_mm: 250, h_mm: 500, concrete: "C30", steel: "HRB400", M_design_kNm: 175 };
const result = {
  task: "design", status: "ok", inputs: input, geometry: { h0_mm: 462, basis: "assumed_single_layer" },
  classification: { class_name: "适筋", label: "正常单筋受弯设计状态", probabilities: { 少筋: 0.01, 适筋: 0.98, 超筋: 0.01 } },
  prediction: { value: 1215.3500269576261, unit: "mm²", model_key: "area" },
  reference: { As_required_mm2: 1212.3763321195704 },
  comparison: { model_minus_reference: 2.9736948380557, relative_error_percent: 0.245277 },
  warnings: [], model_versions: { area: "example-version" }, scope: "普通矩形单筋截面",
};
const request = (body = input, signal) => new Request("http://local/api/beam/design", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
});

test("beam网站接口保留物理单位预测与公式参考，参数只发到配置的内部服务", async t => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(String(url), "http://127.0.0.1:8001/v1/design");
    assert.deepEqual(JSON.parse(options.body), input);
    assert.equal(options.redirect, "error");
    return Response.json(result);
  });
  const response = await beamProxy(request(), "design");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), result);
});

test("beam拒绝布尔值尺寸、额外字段和过大请求，不调用推理服务", async t => {
  const mock = t.mock.method(globalThis, "fetch", async () => { throw new Error("should not call"); });
  for (const body of [{ ...input, b_mm: true }, { ...input, target_url: "http://other" }, { ...input, M_design_kNm: -1 }]) {
    assert.equal((await beamProxy(request(body), "design")).status, 400);
  }
  const large = new Request("http://local/api/beam/design", { method: "POST", headers: { "Content-Type": "application/json" }, body: " ".repeat(20_000) });
  assert.equal((await beamProxy(large, "design")).status, 413);
  assert.equal(mock.mock.callCount(), 0);
});

test("beam透传模型适用范围的中文校验错误", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ detail: "本项目梁高为200~800每50 mm一档，或900 mm" }, { status: 422 }));
  const response = await beamProxy(request(), "design");
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /梁高/);
});

test("beam服务断线时返回可操作提示，格式异常不会当作预测结果", async t => {
  const mock = t.mock.method(globalThis, "fetch", async () => { throw new Error("connection refused"); });
  assert.equal((await beamProxy(request(), "design")).status, 503);
  mock.mock.mockImplementation(async () => Response.json({ ...result, prediction: { ...result.prediction, value: null } }));
  assert.equal((await beamProxy(request(), "design")).status, 502);
  mock.mock.mockImplementation(async () => Response.json({ ...result, task: "review" }));
  assert.equal((await beamProxy(request(), "design")).status, 502);
});

test("beam适用范围以外的状态保留分类与原因并允许空预测", async t => {
  const stopped = { ...result, status: "needs_redesign", prediction: null, comparison: null,
    reference: { status: "needs_redesign", reason: "设计弯矩超过单筋界限" }, warnings: ["请调整截面"] };
  t.mock.method(globalThis, "fetch", async () => Response.json(stopped));
  const response = await beamProxy(request(), "design");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), stopped);
});

test("beam客户端取消请求会取消上游，健康检查失败不泄漏服务细节", async t => {
  const abort = new AbortController();
  t.mock.method(globalThis, "fetch", (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    abort.abort();
  }));
  assert.equal((await beamProxy(request(input, abort.signal), "design")).status, 408);
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => { throw new Error("private details"); });
  const response = await beamHealth(new Request("http://local/api/beam/health"));
  assert.equal(response.status, 503);
  assert.equal(JSON.stringify(await response.json()).includes("private details"), false);
});
