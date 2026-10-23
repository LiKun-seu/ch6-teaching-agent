import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { questions } from "../src/lib/questions.ts";
import { grade } from "../src/lib/grading.ts";
import { getQuestionCatalog, isUsableQuestion } from "../src/lib/question-catalog.ts";
import { answerSession, createSession, displayPrompt, filterQuestions, parseQuestionCount, sampleQuestions, submitSession, summarizeSession } from "../src/lib/self-test/model.ts";
import { createPersistentStore, localStorageAdapter } from "../src/lib/self-test/persistence.ts";
import { decodeSession, SELF_TEST_STORAGE_KEY } from "../src/lib/self-test/store.ts";
import { applySessionErrors, decodeWrongbook, EMPTY_WRONGBOOK, sessionWrongRecords } from "../src/lib/wrongbook/model.ts";
import { WRONGBOOK_STORAGE_KEY } from "../src/lib/wrongbook/store.ts";
import { exportMarkdown, selectExportRecords } from "../src/lib/wrongbook/export.ts";

const catalog = getQuestionCatalog();
const fixture = (id = "fixture", patch = {}) => ({ id, type: "choice", prompt: "测试题目", options: [{ id: "A", text: "甲" }, { id: "B", text: "乙" }], answer: "A", analysis: "测试解析", verified: true, difficulty: "easy", ...patch });
const wrongSession = (id, at = 1) => submitSession(answerSession(createSession([fixture()], "catalog", 0, id), "fixture", "B"), at);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test("150 题元数据逐题覆盖，难度分布真实，原题库未被改写", () => {
  const meta = JSON.parse(fs.readFileSync(new URL("../src/content/question-meta.json", import.meta.url), "utf8"));
  assert.equal(catalog.length, 150);
  assert.equal(new Set(catalog.map(q => q.id)).size, 150);
  assert.deepEqual(Object.keys(meta).sort(), catalog.map(q => q.id).sort());
  assert.ok(Object.values(meta).every(m => m.rationale.length > 5));
  assert.deepEqual(catalog.reduce((a, q) => (a[q.difficulty]++, a), { easy: 0, medium: 0, hard: 0 }), { easy: 47, medium: 79, hard: 24 });
  catalog.forEach(({ difficulty, ...q }, i) => assert.deepEqual(q, questions[i]));
});
test("结构门禁如实排除24道缺损或泄题的已复核题", () => {
  const usable = catalog.filter(isUsableQuestion);
  assert.equal(usable.length, 91);
  assert.deepEqual(usable.reduce((a, q) => (a[q.type]++, a), { choice: 0, judge: 0, fill: 0 }), { choice: 44, judge: 44, fill: 3 });
  for (const q of usable) assert.equal(grade(q, q.answer), true, q.id);
  for (const id of ["SC-20", "SC-25", "SC-30", "SC-67", "TF-24", "TF-29"]) assert.equal(isUsableQuestion(catalog.find(q => q.id === id)), false, id);
  for (const id of ["SC-27", "TF-14", "TF-16"]) assert.equal(isUsableQuestion(catalog.find(q => q.id === id)), true, id);
});
test("可用性独立于难度，标准答案各空及选择结构必须有效", () => {
  assert.equal(isUsableQuestion(fixture("x", { difficulty: undefined })), true);
  for (const patch of [{ verified: false }, { answer: "" }, { answer: "C" }, { options: [] }, { options: [{ id: "A", text: "甲" }, { id: "A", text: "乙" }] }, { type: "fill", answer: "；" }, { type: "fill", answer: "斜拉；" }]) assert.equal(isUsableQuestion(fixture("x", patch)), false);
  assert.equal(isUsableQuestion(fixture("x", { type: "judge", answer: "T", prompt: "必要条件缺失时会失效。（ ）" })), true);
});
test("同维并集、不同维交集及空筛选条件正确", () => {
  const pool = [fixture("a"), fixture("b", { type: "judge", answer: "T", difficulty: "medium" }), fixture("c", { difficulty: "hard" }), fixture("d", { verified: false })];
  assert.deepEqual(filterQuestions(pool, { types: ["choice", "judge"], difficulties: ["easy", "medium"] }).map(q => q.id), ["a", "b"]);
  assert.equal(filterQuestions(pool, { types: [], difficulties: ["easy"] }).length, 0);
  assert.equal(filterQuestions(pool, { types: ["choice"], difficulties: [] }).length, 0);
});
test("无放回洗牌不改原数组，随机源可注入且拒绝不足题量", () => {
  const pool = [fixture("a"), fixture("b"), fixture("c")]; const before = JSON.stringify(pool);
  assert.deepEqual(sampleQuestions(pool, 2, () => 0).map(q => q.id), ["b", "c"]);
  assert.equal(JSON.stringify(pool), before);
  assert.equal(new Set(sampleQuestions([...pool, pool[0]], 3, () => .5).map(q => q.id)).size, 3);
  assert.throws(() => sampleQuestions(pool, 4), /当前条件仅有 3 题/);
  for (const count of [0, -1, NaN, 1.5]) assert.throws(() => sampleQuestions(pool, count));
  assert.throws(() => sampleQuestions(pool, 2, () => 1), /随机源/);
});
test("自定义题量必须是安全正整数", () => {
  for (const raw of ["", "0", "-1", "1.1", "1e2", "Infinity", "9007199254740992", "abc"]) assert.equal(parseQuestionCount(raw), null, raw);
  assert.equal(parseQuestionCount(" 30 "), 30);
});
test("会话快照独立于题库，作答顺序与答案可序列化恢复", () => {
  const q = fixture(); const session = answerSession(createSession([q]), q.id, "B");
  q.prompt = "新题干"; q.options[0].text = "新选项";
  const restored = decodeSession(JSON.parse(JSON.stringify(session)));
  assert.equal(restored.questions[0].prompt, "测试题目"); assert.equal(restored.questions[0].options[0].text, "甲");
  assert.deepEqual(restored.answers, { fixture: "B" });
  assert.equal(answerSession(submitSession(session), "fixture", "A").answers.fixture, "B");
});
test("三态判题与空白独立，正确率不隐藏未答或除零", () => {
  const qs = [fixture("a"), fixture("b"), fixture("c", { type: "fill", answer: "很长的描述性答案需要人工核对语义，不能仅凭子串判断", options: [] }), fixture("d")];
  let s = createSession(qs); s = answerSession(s, "a", "A"); s = answerSession(s, "b", "B"); s = answerSession(s, "c", "另一种解释"); s = answerSession(s, "d", "  ");
  s = submitSession(s, 1);
  assert.deepEqual(s.results.map(r => r.status), ["correct", "wrong", "pending", "unanswered"]);
  assert.deepEqual(summarizeSession(s), { correct: 1, wrong: 1, pending: 1, unanswered: 1, total: 4, answered: 3, completion: .75, accuracy: .5 });
  assert.equal(summarizeSession(submitSession(createSession([fixture()]))).accuracy, null);
  assert.equal(submitSession(s, 9), s);
});
test("填空沿用等价写法、空位顺序、数值和单位判定", () => {
  const q = fixture("fill", { type: "fill", options: [], answer: "0.5；10mm", acceptedAnswers: [[".5"], []] });
  assert.equal(submitSession(answerSession(createSession([q]), q.id, ".500；10 mm")).results[0].status, "correct");
  for (const raw of ["10mm；0.5", "0.5；10cm", "0.5"]) assert.equal(submitSession(answerSession(createSession([q]), q.id, raw)).results[0].status, "wrong");
});
test("仅答错入错题本，按题ID去重及场次幂等，重练答对保留记录", () => {
  const first = wrongSession("s1"); let state = applySessionErrors(EMPTY_WRONGBOOK, first);
  assert.equal(state.records[0].wrongCount, 1); assert.equal(applySessionErrors(state, first), state);
  state = applySessionErrors(state, wrongSession("s2", 2)); assert.equal(state.records[0].wrongCount, 2);
  const correct = submitSession(answerSession(createSession([fixture()], "wrongbook-snapshot", 3, "s3"), "fixture", "A"));
  state = applySessionErrors(state, correct); assert.equal(state.records[0].wrongCount, 2);
  state = { ...state, records: [] }; assert.equal(applySessionErrors(state, first), state);
  assert.equal(applySessionErrors(EMPTY_WRONGBOOK, submitSession(createSession([fixture()]))).records.length, 0);
});
test("题库更新不影响错题快照，最近错误证据和导出本场快照准确", () => {
  const first = wrongSession("s1"); const state = applySessionErrors(EMPTY_WRONGBOOK, first);
  first.questions[0].prompt = "后来外部修改";
  assert.equal(state.records[0].question.prompt, "测试题目");
  const current = wrongSession("s2", 2); current.questions[0].prompt = "第二版";
  assert.equal(sessionWrongRecords(current)[0].question.prompt, "第二版");
  assert.equal(decodeWrongbook(JSON.parse(JSON.stringify(state))).records[0].wrongCount, 1);
});
test("存储无80条截断且使用独立key，不触碰现有笔记", async () => {
  assert.notEqual(SELF_TEST_STORAGE_KEY, WRONGBOOK_STORAGE_KEY);
  const records = Array.from({ length: 100 }, (_, i) => ({ ...applySessionErrors(EMPTY_WRONGBOOK, wrongSession("s" + i)).records[0], questionId: "q" + i, question: fixture("q" + i) }));
  assert.equal(decodeWrongbook({ version: 1, records, appliedSessionIds: [] }).records.length, 100);
  const original = globalThis.localStorage; const data = new Map([["ch6-notes-v2", "old notes"]]);
  globalThis.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  try { await localStorageAdapter(WRONGBOOK_STORAGE_KEY, EMPTY_WRONGBOOK, decodeWrongbook).write(EMPTY_WRONGBOOK); assert.equal(data.get("ch6-notes-v2"), "old notes"); }
  finally { globalThis.localStorage = original; }
});
test("读取失败阻止覆盖，重试读取恢复原有集合", async () => {
  let fail = true, writes = 0;
  const store = createPersistentStore({ async read() { if (fail) throw Error("corrupt"); return 10; }, async write() { writes++; } }, 0, "测试");
  assert.equal(await store.update(value => value + 1), false); assert.equal(writes, 0); assert.match(store.getSnapshot().error, /读取/);
  fail = false; await store.retry(); await store.update(value => value + 1); assert.equal(store.getSnapshot().value, 11); assert.equal(writes, 1);
});
test("并发读取重试共用一个请求，晚到旧读取不能覆盖新值", async () => {
  const read = deferred(); let calls = 0, persisted;
  const store = createPersistentStore({ read() { calls++; return calls === 1 ? Promise.reject(Error("fail")) : read.promise; }, async write(value) { persisted = value; } }, 0, "测试");
  await store.initialize(); const a = store.retry(), b = store.retry(); assert.equal(calls, 2);
  read.resolve(10); await Promise.all([a, b]); await store.update(value => value + 1);
  assert.equal(store.getSnapshot().value, 11); assert.equal(persisted, 11); assert.equal(store.getSnapshot().dirty, false);
});
test("写失败保留连续更新，后续重试保存完整内存", async () => {
  let fail = true, persisted; const store = createPersistentStore({ async read() { return []; }, async write(value) { if (fail) throw Error("quota"); persisted = value; } }, [], "测试");
  await store.update(value => [...value, "a"]); await store.update(value => [...value, "b"]);
  assert.deepEqual(store.getSnapshot().value, ["a", "b"]); assert.equal(store.getSnapshot().dirty, true);
  fail = false; await store.retry(); assert.deepEqual(persisted, ["a", "b"]); assert.equal(store.getSnapshot().error, null);
});
test("串行写入旧成功不会把仍在等待的新状态标为保存完成", async () => {
  const first = deferred(), second = deferred(); let calls = 0;
  const store = createPersistentStore({ async read() { return 0; }, write() { return ++calls === 1 ? first.promise : second.promise; } }, 0, "测试");
  await store.initialize(); const a = store.update(() => 1); const b = store.update(() => 2); await Promise.resolve(); await Promise.resolve();
  first.resolve(); await a; assert.equal(store.getSnapshot().dirty, true);
  second.reject(Error("quota")); await b; assert.equal(store.getSnapshot().value, 2); assert.equal(store.getSnapshot().dirty, true);
});
test("损坏的可选判题字段拒绝读取，避免grade崩溃和旧数据覆盖", async () => {
  for (const patch of [{ acceptedAnswers: ["invalid-shape"] }, { acceptedAnswers: [[123]] }, { tolerance: "bad" }, { tolerance: -1 }, { verified: "true" }]) {
    const raw = createSession([fixture("q", { type: "fill", options: [], ...patch })]);
    assert.throws(() => decodeSession(raw), /格式无效/);
    let writes = 0; const store = createPersistentStore({ async read() { return decodeSession(raw); }, async write() { writes++; } }, null, "自测");
    await store.update(() => null); assert.equal(writes, 0); assert.equal(store.getSnapshot().writable, false);
  }
});
test("导出范围与10/20预选依最近错误时间排序，空范围拒绝导出", () => {
  const records = Array.from({ length: 25 }, (_, i) => ({ ...sessionWrongRecords(wrongSession("s" + i, i))[0], questionId: "q" + i }));
  assert.equal(selectExportRecords(records, "all", [], [], 10).length, 10);
  assert.equal(selectExportRecords(records, "all", [], [], 20).length, 20);
  assert.deepEqual(selectExportRecords(records, "selected", ["q2", "q20"], [], null).map(r => r.questionId), ["q20", "q2"]);
  assert.deepEqual(selectExportRecords(records, "session", [], ["q7"], null).map(r => r.questionId), ["q7"]);
  assert.throws(() => exportMarkdown([], "blank", "all"), /没有错题/);
});
test("三种模板遵守个人作答和答案边界，文件名与范围日期明确", () => {
  const records = sessionWrongRecords(wrongSession("s")); records[0].standardAnswer = "独有标准答案"; records[0].analysis = "独有解析"; records[0].lastWrongAnswer = "独有错误";
  const at = new Date(2026, 9, 20);
  const blank = exportMarkdown(records, "blank", "selected", at);
  for (const secret of ["独有标准答案", "独有解析", "独有错误", "标准答案", "我的错误答案", "解析："]) assert.ok(!blank.markdown.includes(secret), secret);
  assert.match(blank.filename, /2026-10-20-空白重练-1题.md/); assert.match(blank.markdown, /当前勾选/);
  const review = exportMarkdown(records, "review", "all", at); assert.ok(!review.markdown.includes("独有错误")); assert.match(review.markdown, /独有标准答案/);
  const correction = exportMarkdown(records, "correction", "session", at); assert.match(correction.markdown, /独有错误/); assert.match(correction.markdown, /独有解析/);
});
test("显示保留SC66必要纠正及SC51剪扭适用条件", () => {
  assert.match(displayPrompt(catalog.find(q => q.id === "SC-66")), /第二空为弯矩图/);
  assert.match(displayPrompt(catalog.find(q => q.id === "SC-51")), /h_w\/b≤4/);
});
