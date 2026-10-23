import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

// Independent, temporary browser context; all predictions hit the real local API.
const target = process.env.BEAM_PREVIEW_URL || "http://127.0.0.1:3000/beam-lab";
const base = new URL(target);
const prefix = base.pathname.replace(/\/beam-lab\/?$/, "").replace(/\/$/, "");
const api = task => `${base.origin}${prefix}/api/beam/${task}`;
const output = path.resolve(process.env.BEAM_APPROVAL_DIR || "../../approval");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ ...(process.platform === "win32" ? { channel: process.env.BEAM_BROWSER_CHANNEL || "msedge" } : {}), headless: true });
const context = await browser.newContext({ viewport: { width: 1536, height: 1100 }, deviceScaleFactor: 1, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
const checks = [];
page.on("pageerror", error => errors.push(error.message));
const check = name => { checks.push(name); console.log(`PASS ${name}`); };
async function submit(task, status = 200) {
  const responsePromise = page.waitForResponse(response => response.url() === api(task) && response.request().method() === "POST");
  await page.getByRole("button", { name: /^(开始计算|修改后重试)$/ }).click();
  const response = await responsePromise;
  assert.equal(response.status(), status, await response.text());
  const data = await response.json();
  await page.getByRole("button", { name: /^(开始计算|修改后重试)$/ }).waitFor({ state: "visible" });
  return data;
}
async function snapshot(name) { await page.screenshot({ path: path.join(output, name), fullPage: false }); }

try {
  await page.goto(target, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "智能配筋实验", exact: true }).waitFor();
  const design = await submit("design");
  assert.ok(Math.abs(design.prediction.value - 1215.3500269576261) < 1e-7);
  assert.equal(design.geometry.h0_mm, 462);
  await page.getByText("设计状态分类 A", { exact: true }).waitFor();
  await page.getByText("CatBoost 预测", { exact: true }).waitFor();
  check("设计默认示例调用真实权重并正确还原面积");
  await snapshot("design-desktop.png");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载结果 JSON", exact: true }).click();
  const download = await downloadPromise;
  await download.saveAs(path.join(output, "design-result.json"));
  const downloaded = JSON.parse(await fs.readFile(path.join(output, "design-result.json"), "utf8"));
  assert.equal(downloaded.prediction.value, design.prediction.value);
  assert.equal(Object.keys(downloaded.model_versions).length, 4);
  check("结果JSON导出保留真实预测和四个模型版本");

  await page.getByLabel("设计弯矩 M（kN·m）", { exact: true }).fill("200");
  await page.getByText("参数已变更，请重新计算", { exact: true }).waitFor();
  assert.equal(await page.getByText("CatBoost 预测", { exact: true }).count(), 0);
  check("修改参数立即清除旧结果");

  await page.getByLabel("有效高度 h₀ 的来源", { exact: true }).click();
  await page.getByRole("option", { name: "直接填写 h₀", exact: true }).click();
  await page.getByLabel("有效高度 h₀（mm）", { exact: false }).fill("10");
  await page.getByLabel("设计弯矩 M（kN·m）", { exact: true }).fill("0");
  const boundary = await submit("design");
  assert.equal(boundary.status, "needs_redesign");
  assert.equal(boundary.prediction, null);
  await page.getByText("暂不预测", { exact: true }).waitFor();
  check("最小配筋与单筋上限冲突时停止回归并显示原因");

  await page.getByRole("button", { name: "载入示例", exact: true }).click();
  await page.getByLabel("箍筋直径（mm）", { exact: true }).fill("12");
  await page.getByLabel("预估纵筋直径（mm）", { exact: true }).fill("21");
  const unlisted = await submit("design");
  assert.equal(unlisted.geometry.h0_mm, 457.5);
  assert.ok(unlisted.prediction.value > 0);
  assert.ok(unlisted.warnings.some(item => /采样|12|21/.test(item)));
  check("原预测入口允许的12/21mm直径可用且显示采样差异");

  await page.getByLabel("梁高 h（mm）", { exact: true }).fill("525");
  await submit("design", 422);
  await page.getByRole("alert").getByText(/梁高/).waitFor();
  assert.equal(await page.getByLabel("梁高 h（mm）", { exact: true }).inputValue(), "525");
  check("不支持的截面尺寸显示中文错误并保留输入");

  await page.getByRole("button", { name: /^实配钢筋复核/ }).click();
  const review = await submit("review");
  assert.ok(Math.abs(review.prediction.value - 82.25017067719503) < 1e-7);
  assert.equal(review.comparison.model_meets, true);
  assert.equal(review.comparison.reference_meets, true);
  await page.getByText("实配配筋状态分类 B", { exact: true }).waitFor();
  await fs.writeFile(path.join(output, "review-result.json"), JSON.stringify(review, null, 2));
  check("复核默认示例正确还原Mu并分别比较需求");
  await page.getByText("CatBoost 预测", { exact: true }).scrollIntoViewIfNeeded();
  await snapshot("review-desktop.png");

  await page.getByLabel(/设计弯矩 M（kN·m）/).fill("");
  const noMoment = await submit("review");
  assert.equal(noMoment.inputs.M_design_kNm, null);
  assert.equal(noMoment.comparison.model_meets, undefined);
  await page.getByText("未提供设计弯矩，本次仅计算承载力，不给出需求满足判断。", { exact: true }).waitFor();
  check("未填写复核弯矩时只展示承载力");

  await page.getByLabel(/设计弯矩 M（kN·m）/).fill("81.9");
  const disagreement = await submit("review");
  assert.equal(disagreement.comparison.decision_disagrees, true);
  await page.getByText("模型与公式参考的满足判断不一致，请结合公式和边界条件复核。", { exact: true }).waitFor();
  check("真实边界示例显式展示模型与公式判断分歧");

  await page.getByLabel("实配钢筋面积 As（mm²）", { exact: true }).fill("100");
  const under = await submit("review");
  assert.equal(under.status, "below_minimum_reinforcement");
  assert.equal(under.prediction, null);
  check("少筋侧不调用正常Mu回归");
  await page.getByLabel("实配钢筋面积 As（mm²）", { exact: true }).fill("1900");
  const over = await submit("review");
  assert.equal(over.status, "beyond_single_reinforced_method");
  assert.equal(over.prediction, null);
  check("超出单筋上限时不调用正常Mu回归");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(target, { waitUntil: "networkidle" });
  await submit("design");
  await page.getByText("CatBoost 预测", { exact: true }).scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await snapshot("design-mobile.png");
  check("390px手机布局可提交且无页面横向溢出");

  await page.getByRole("button", { name: "请 AI 讲解本次结果", exact: true }).click();
  await page.getByRole("button", { name: /收起/ }).waitFor();
  await page.getByText(/没有可用的对话模型|模型通道/).filter({ visible: true }).first().waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: /收起/ }).click();
  await page.getByRole("button", { name: "开始计算", exact: true }).waitFor();
  check("AI讲解带入实际结果，缺少凭证时明确提示且手机面板可返回");

  await page.route("**/api/beam/design", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "测试：模型服务暂不可用" }) }));
  await submit("design", 503);
  await page.getByRole("alert").getByText("测试：模型服务暂不可用", { exact: true }).waitFor();
  await page.unroute("**/api/beam/design");
  await submit("design");
  await page.getByText("CatBoost 预测", { exact: true }).waitFor();
  check("服务错误可见并能用原输入重试成功");

  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, "browser-checks.json"), JSON.stringify({ target, browser: browser.version(), checks, pageErrors: errors, passed: true }, null, 2));
  console.log(JSON.stringify({ passed: true, checks: checks.length, output }));
} finally { await context.close(); await browser.close(); }
