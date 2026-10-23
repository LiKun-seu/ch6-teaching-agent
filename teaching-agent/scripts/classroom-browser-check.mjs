import assert from "node:assert/strict";
import path from "node:path";

/** Uses real HTTPS so production HttpOnly/Secure cookies are exercised in each target browser. */
export async function classroomBrowserCheck({ context, page, origin, basePath, output, assertTeacherStreams }) {
  const endpoint = origin + basePath;
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(endpoint + "/classroom", { waitUntil: "networkidle" });
  await page.getByLabel("教师访问码", { exact: true }).fill("classroom-browser-test-only");
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  await page.getByLabel("课堂标题", { exact: true }).fill("CI 实时课堂");
  await page.getByRole("button", { name: "创建课堂", exact: true }).click();
  const invite = page.getByRole("textbox", { name: "学生入课链接", exact: true });
  await invite.waitFor();
  const url = await invite.inputValue();
  assert.ok(url.startsWith(endpoint + "/join/"), "Invite must preserve HTTPS origin and basePath");
  assert.match(url, /\/join\/\d{6}$/);
  const qr = page.getByRole("img", { name: "学生入课二维码", exact: true });
  await qr.evaluate(image => image.decode());
  assert.ok(await qr.evaluate(image => image.naturalWidth > 0));
  await qr.screenshot({ path: path.join(output, "classroom-qr.png") });
  const code = url.split("/").at(-1);
  const student = await context.newPage();
  student.on("pageerror", error => errors.push(error.message));
  // Same device cookies still have distinct teacher/student credentials; the API tests
  // and 100-client load check additionally cover independent devices/session jars.
  await student.goto(endpoint + "/join", { waitUntil: "networkidle" });
  await student.getByLabel("课堂码", { exact: true }).fill(code);
  await student.getByLabel("姓名", { exact: true }).fill("浏览器学生");
  await student.getByRole("button", { name: "加入课堂", exact: true }).click();
  await student.getByText("已加入，等待老师开始上课。", { exact: true }).waitFor();
  const cookies = await context.cookies(endpoint + "/");
  for (const name of ["ch6_classroom_teacher", "ch6_classroom_student"]) {
    const cookie = cookies.find(cookie => cookie.name === name); assert.ok(cookie, name);
    assert.equal(cookie.httpOnly, true); assert.equal(cookie.secure, true); assert.equal(cookie.sameSite, "Lax");
    assert.equal(cookie.path, (basePath || "") + "/");
  }
  await page.bringToFront();
  await page.getByText("已加入 1 人", { exact: true }).waitFor();
  await page.getByRole("button", { name: "开始上课", exact: true }).click();
  await student.bringToFront();
  await student.getByText("等待老师发题。", { exact: true }).waitFor();
  // Fetch inside Chrome: 10.0.2.2 is an emulator-only alias, not a host Node address.
  const { questions } = await page.evaluate(async url => {
    const response = await fetch(url); if (!response.ok) throw new Error("Teacher catalog failed");
    return response.json();
  }, endpoint + "/api/classrooms/catalog");
  for (const type of ["choice", "judge", "fill"]) {
    await page.bringToFront();
    const q = questions.find(q => q.type === type); assert.ok(q, type);
    // Drive the Select and publication button, while choosing a stable fixture by catalog ID.
    await page.getByRole("combobox", { name: "选择课堂题目", exact: true }).click();
    await page.getByRole("option").filter({ hasText: q.id + " ·" }).first().click();
    await page.getByRole("button", { name: "发布题目", exact: true }).click();
    await student.bringToFront();
    const answerButton = student.getByRole("button", { name: "提交答案", exact: true });
    await answerButton.waitFor();
    if (type === "fill") await student.getByRole("textbox", { name: "你的答案", exact: true }).fill("浏览器填空答案");
    else await student.getByRole("button", { name: type === "judge" ? /^T/ : new RegExp("^" + q.options[0].id) }).click();
    await answerButton.click();
    await student.getByRole("button", { name: "修改并提交", exact: true }).waitFor();
    if (type === "choice") {
      // A dropped HTTP request must retain the last successful answer and expose retry.
      await student.route("**/api/classroom-participation/**/answer", route => route.abort("failed"));
      await student.getByRole("button", { name: "修改并提交", exact: true }).click();
      await student.getByRole("status").filter({ hasText: "提交失败，请重试" }).waitFor();
      await student.unroute("**/api/classroom-participation/**/answer");
      await student.getByRole("button", { name: "修改并提交", exact: true }).click();
      await student.getByRole("status").filter({ hasText: /^已提交/ }).waitFor();
    }
    await page.bringToFront();
    await page.getByText(/已答 1 · 未答 0/).waitFor();
    await student.bringToFront();
    const beforeReload = await student.getByRole("region", { name: "当前课堂题目" }).innerText();
    assert.ok(!beforeReload.includes("标准答案："));
    // A full reload restores identity and successful submission without adding a participant.
    await student.reload({ waitUntil: "domcontentloaded" });
    await student.getByRole("button", { name: "修改并提交", exact: true }).waitFor();
    await page.bringToFront();
    await page.getByText("已加入 1 人", { exact: true }).waitFor();
    await page.getByRole("button", { name: "收题", exact: true }).click();
    await student.bringToFront();
    await student.getByText("本题已收题，等待老师公布。", { exact: true }).waitFor();
    await page.bringToFront();
    await page.getByRole("button", { name: "公布答案与解析", exact: true }).click();
    await student.bringToFront();
    await student.getByText("标准答案：", { exact: false }).last().waitFor();
  }
  await page.bringToFront();
  await page.goto(endpoint + "/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "进入学习", exact: true }).click();
  const chatDraft = page.locator("textarea:visible").first();
  await chatDraft.fill("切换页面后保留的对话草稿");
  const shellUrl = page.url();
  async function navigate(label) {
    let button = page.getByRole("button", { name: label, exact: true });
    if (!(await button.isVisible())) {
      await page.getByRole("button", { name: "Toggle Sidebar", exact: true }).filter({ visible: true }).first().click();
      button = page.getByRole("button", { name: label, exact: true });
    }
    await button.click();
    // A closing mobile Sheet remains visible during its exit animation. Wait for
    // removal before the next navigation can decide whether to reopen it.
    await page.getByRole("dialog").waitFor({ state: "hidden" });
  }
  await navigate("题库自测");
  await page.getByRole("heading", { name: "题库自测", exact: true }).waitFor();
  await navigate("实时课堂");
  await page.getByRole("textbox", { name: "学生入课链接", exact: true }).waitFor();
  await assertTeacherStreams(1);
  await navigate("引导对话");
  assert.equal(await chatDraft.inputValue(), "切换页面后保留的对话草稿");
  await assertTeacherStreams(0);
  assert.equal(page.url(), shellUrl, "Navigation must preserve the mounted chat pane");
  await navigate("实时课堂");
  await page.getByRole("textbox", { name: "学生入课链接", exact: true }).waitFor();
  await assertTeacherStreams(1);
  await page.bringToFront();
  await page.locator("main:visible").first().evaluate(main => { main.scrollTop = 0; });
  await page.screenshot({ path: path.join(output, "classroom-teacher.png"), fullPage: true });
  await student.bringToFront();
  await student.screenshot({ path: path.join(output, "classroom-student.png"), fullPage: true });
  await page.bringToFront();
  await page.getByRole("button", { name: "结束课堂", exact: true }).click();
  await page.getByRole("button", { name: "确认结束", exact: true }).click();
  await student.bringToFront();
  await student.getByText("课堂已结束，感谢参与。", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  await student.close();
  console.log("PASS classroom: HTTPS/Secure cookies, QR, join, 3 types, retry, refresh, close/reveal/end, integrated navigation, preserved chat, subscription cleanup");
}
