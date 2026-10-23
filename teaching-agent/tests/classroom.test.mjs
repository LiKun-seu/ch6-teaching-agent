import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { ClassroomStore, ClassroomError, digest } from "../src/lib/classroom/store.ts";
import { classroomQuestion, classroomCatalog } from "../src/lib/classroom/catalog.ts";
import { classroomEvents } from "../src/lib/classroom/stream.ts";
import { readSseData } from "../src/lib/sse.ts";
import { withBasePath } from "../src/lib/app-path.ts";
import { questions } from "../src/lib/questions.ts";

const directory = mkdtempSync(join(tmpdir(), "ch6-classroom-"));
process.env.CLASSROOM_TEACHER_ACCESS_CODE = "test-only-private-access-code";
process.env.CLASSROOM_PUBLIC_ORIGIN = "https://classroom.example";
process.env.CLASSROOM_DB_PATH = join(directory, "http.sqlite");
const { classroomHttp, joinUrl, publicOrigin, TEACHER_COOKIE, STUDENT_COOKIE } = await import("../src/lib/classroom/http.ts");
const { classroomStore } = await import("../src/lib/classroom/store.ts");
const { loadHook, hooks } = createRequire(import.meta.url)("./hook-harness.cjs");
const q = type => questions.find(q => q.type === type && classroomCatalog().some(c => c.id === q.id));
const stores = [];
const joinClass = (store, code, name, studentNo = "", previous) => store.join(code, name, studentNo, store.deviceSession(previous));
after(() => { classroomStore().close(); for (const store of stores) try { store.close(); } catch {} rmSync(directory, { recursive: true, force: true }); });
function fixture(filename = randomUUID() + ".sqlite") {
  const path = join(directory, filename), store = new ClassroomStore(path); stores.push(store);
  const credential = store.login(process.env.CLASSROOM_TEACHER_ACCESS_CODE), owner = store.teacher(credential);
  const c = store.create(owner, "测试课堂", randomUUID());
  const p = joinClass(store, c.code, "同名学生");
  store.start(owner, c.id);
  return { store, path, credential, owner, c, p };
}
function assertRedacted(state, question) {
  for (const round of state.rounds) {
    if (round.status === "revealed") continue;
    assert.equal(Object.hasOwn(round, "answer"), false); assert.equal(Object.hasOwn(round, "analysis"), false);
    assert.equal(Object.hasOwn(round.question, "answer"), false); assert.equal(Object.hasOwn(round.question, "acceptedAnswers"), false);
    assert.equal(Object.hasOwn(round.question, "analysis"), false); assert.equal(Object.hasOwn(round.question, "verified"), false);
    if (round.submission) assert.equal(Object.hasOwn(round.submission, "grade"), false);
  }
  assert.equal(Object.hasOwn(state, "participants"), false);
  assert.ok(!JSON.stringify(state).includes(process.env.CLASSROOM_TEACHER_ACCESS_CODE));
  assert.ok(!JSON.stringify(state).includes('"submissions"'));
  if (question.analysis) assert.ok(!JSON.stringify(state).includes(JSON.stringify(question.analysis).slice(1, -1)));
}

test("课堂 SQLite：三种题型、修改答案、轮次隔离、收题/公布幂等、结束冻结", () => {
  const { store, owner, c, p } = fixture();
  const other = joinClass(store, c.code, "同名学生");
  assert.notEqual(p.participantId, other.participantId);
  assert.equal(joinClass(store, c.code, "更名不重建", "", p.token).participantId, p.participantId);
  assert.equal(store.teacherSnapshot(owner, c.id).participants.length, 2);
  let previousRound;
  for (const type of ["choice", "judge", "fill"]) {
    const question = q(type); assert.ok(question, `verified ${type} exists`);
    const key = randomUUID(), round = store.publish(owner, c.id, classroomQuestion(question.id), key);
    assert.equal(store.publish(owner, c.id, question, key), round);
    assert.notEqual(round, previousRound); previousRound = round;
    assert.throws(() => store.publish(owner, c.id, question, randomUUID()), /先收/);
    assert.throws(() => store.changeRound(owner, c.id, round, "reveal"), /先收题/);
    if (type === "choice") assert.throws(() => store.answer(p.token, c.id, round, "INVALID", randomUUID()), /合法选项/);
    if (type === "judge") assert.throws(() => store.answer(p.token, c.id, round, "true", randomUUID()), /合法选项/);
    const answer = type === "choice" ? question.options[0].id : type === "judge" ? "T" : "一份需要核对的答案";
    const answerKey = randomUUID(); store.answer(p.token, c.id, round, answer, answerKey); store.answer(p.token, c.id, round, answer, answerKey);
    assert.equal(store.studentSnapshot(p.token, c.id).rounds.at(-1).submission.revision, 1);
    const final = type === "choice" ? question.options[1].id : type === "judge" ? "F" : question.answer;
    store.answer(p.token, c.id, round, final, randomUUID());
    // A late retry of the old command cannot overwrite a newer successful answer.
    store.answer(p.token, c.id, round, answer, answerKey);
    const snapshot = store.studentSnapshot(p.token, c.id); assertRedacted(snapshot, question);
    assert.equal(snapshot.rounds.at(-1).submission.answer, final);
    const stats = store.teacherSnapshot(owner, c.id).rounds.at(-1).stats;
    assert.equal(stats.submitted, 1); assert.equal(stats.unanswered, 1);
    assert.equal(stats.correct + stats.incorrect + stats.pending, 1);
    store.changeRound(owner, c.id, round, "close"); store.changeRound(owner, c.id, round, "close");
    assert.throws(() => store.answer(p.token, c.id, round, answer, randomUUID()), /已收题/);
    assertRedacted(store.studentSnapshot(p.token, c.id), question);
    store.changeRound(owner, c.id, round, "reveal"); store.changeRound(owner, c.id, round, "reveal");
    const revealed = store.studentSnapshot(p.token, c.id).rounds.at(-1);
    assert.equal(revealed.answer, question.answer); assert.equal(revealed.analysis, question.analysis);
    assert.ok(Object.hasOwn(revealed.submission, "grade"));
  }
  const round = store.publish(owner, c.id, q("choice"), randomUUID());
  store.end(owner, c.id); store.end(owner, c.id);
  assert.equal(store.studentSnapshot(p.token, c.id).classroom.status, "ended");
  assert.equal(store.teacherSnapshot(owner, c.id).rounds.at(-1).status, "closed");
  assert.throws(() => store.join(c.code, "迟到学生", ""), /已结束/);
  assert.throws(() => store.answer(p.token, c.id, round, "A", randomUUID()), /已收题/);
  assert.throws(() => store.start(owner, c.id), /已结束/);
  assert.throws(() => store.changeRound(owner, c.id, round, "reveal"), /只读/);
});

test("课堂：SQLite 重开、跨连接版本、过期会话与多课堂/教师隔离", () => {
  const f = fixture(); const { store, owner, c, p } = f;
  const c2 = store.create(owner, "另一课堂", randomUUID());
  const otherOwner = store.teacher(store.login(process.env.CLASSROOM_TEACHER_ACCESS_CODE));
  assert.throws(() => store.teacherSnapshot(otherOwner, c.id), /不属于/);
  assert.throws(() => store.studentSnapshot(p.token, c2.id), /过期/);
  assert.throws(() => store.teacher(p.token), /过期/);
  assert.throws(() => store.studentSnapshot(f.credential, c.id), /过期/);
  const round = store.publish(owner, c.id, q("choice"), randomUUID());
  const other = new ClassroomStore(f.path); stores.push(other);
  other.answer(p.token, c.id, round, q("choice").options[0].id, randomUUID());
  assert.equal(store.teacherSnapshot(owner, c.id).rounds[0].stats.submitted, 1);
  other.changeRound(owner, c.id, round, "close");
  assert.throws(() => store.answer(p.token, c.id, round, "A", randomUUID()), /已收题/);
  store.close();
  const reopened = new ClassroomStore(f.path); stores.push(reopened);
  assert.equal(reopened.studentSnapshot(p.token, c.id).rounds[0].submission.revision, 1);
  assert.equal(reopened.teacherSnapshot(owner, c.id).rounds[0].status, "closed");
  reopened.run("UPDATE student_sessions SET expires_at=0 WHERE hash=?", digest(p.token));
  assert.throws(() => reopened.studentSnapshot(p.token, c.id), /过期/);
  reopened.run("UPDATE teacher_sessions SET expires_at=0");
  assert.throws(() => reopened.teacher(f.credential), /过期/);
  assert.equal(reopened.get("PRAGMA user_version").user_version, 1);
});

test("课堂：长描述填空使用现有三态判题，未答与待核对独立统计", () => {
  const { store, owner, c, p } = fixture();
  const question = { ...q("fill"), answer: "这是一个超过二十个汉字的标准长描述答案需要教师亲自核对内容是否等价" };
  const round = store.publish(owner, c.id, question, randomUUID());
  store.answer(p.token, c.id, round, "另一种长描述", randomUUID());
  joinClass(store, c.code, "未答学生");
  const stats = store.teacherSnapshot(owner, c.id).rounds[0].stats;
  assert.equal(stats.pending, 1); assert.equal(stats.unanswered, 1); assert.equal(stats.incorrect, 0);
});

test("课堂：部署脚本的在线备份包含 WAL 中已提交的课堂与作答", () => {
  const { store, owner, c, p, path } = fixture();
  const question = q("choice"), round = store.publish(owner, c.id, question, randomUUID());
  store.answer(p.token, c.id, round, question.options[0].id, randomUUID());
  const backup = join(directory, randomUUID() + ".sqlite");
  execFileSync(process.execPath, ["deploy/classroom-db.mjs", "backup", path, backup], { encoding: "utf8" });
  const checked = JSON.parse(execFileSync(process.execPath, ["deploy/classroom-db.mjs", "check", backup], { encoding: "utf8" }));
  assert.equal(checked.schema.user_version, 1); assert.deepEqual(checked.foreignKeys, []); assert.equal(checked.integrity[0].quick_check, "ok");
  const restored = new ClassroomStore(backup); stores.push(restored);
  assert.equal(restored.teacherSnapshot(owner, c.id).rounds[0].stats.submitted, 1);
});

test("课堂：真实独立进程并发收题/提交，由短事务顺序决定结果", async () => {
  const { store, path, owner, c, p } = fixture();
  const question = q("choice"), round = store.publish(owner, c.id, question, randomUUID());
  const workers = ["answer", "close"].map(action => {
    const child = spawn(process.execPath, ["--import", "./scripts/register-ts.mjs", "tests/fixtures/classroom-race-worker.mjs", path, action, owner, c.id, round, p.token, question.options[0].id], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", c => { stdout += c; }); child.stderr.on("data", c => { stderr += c; });
    const ready = once(child, "message");
    const result = new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", code => code ? reject(new Error(stderr)) : resolve(JSON.parse(stdout))); });
    return { child, ready, result };
  });
  await Promise.all(workers.map(w => w.ready)); workers.forEach(w => w.child.send("go"));
  const results = await Promise.all(workers.map(w => w.result));
  assert.equal(results[1].ok, true);
  assert.ok(results[0].ok || results[0].status === 409);
  const teacher = store.teacherSnapshot(owner, c.id);
  assert.equal(teacher.rounds[0].status, "closed");
  assert.equal(teacher.rounds[0].stats.submitted, results[0].ok ? 1 : 0);
  assert.throws(() => store.answer(p.token, c.id, round, question.options[0].id, randomUUID()), /已收题/);
});

test("课堂 SSE：初始/旧游标均返回经过权限过滤的最新快照，跨连接更新与取消清理", async () => {
  const { store, owner, c, p, path } = fixture();
  const question = q("choice"); store.publish(owner, c.id, question, randomUUID());
  const abort = new AbortController();
  const response = classroomEvents(new Request("https://classroom.example/events", { signal: abort.signal, headers: { "Last-Event-ID": "999999" } }), store, c.id, "s:" + digest(p.token), () => store.studentSnapshot(p.token, c.id), 2);
  assert.equal(response.headers.get("x-accel-buffering"), "no");
  const iterator = readSseData(response.body)[Symbol.asyncIterator]();
  const first = JSON.parse((await iterator.next()).value); assertRedacted(first, question);
  const secondStore = new ClassroomStore(path); stores.push(secondStore);
  joinClass(secondStore, c.code, "第二设备");
  const second = JSON.parse((await iterator.next()).value);
  assert.ok(second.classroom.version > first.classroom.version); assertRedacted(second, question);
  abort.abort(); await iterator.return();
  assert.equal(store.get("SELECT COUNT(*) AS n FROM stream_leases").n, 0);
});

test("课堂 SSE：同校园 NAT 不限 3 连接，独立会话配额、心跳与过期租约恢复", () => {
  const { store } = fixture();
  for (let i = 0; i < 100; i++) store.lease("student:" + i, 2);
  store.lease("student:0", 2);
  assert.throws(() => store.lease("student:0", 2), error => error.status === 429);
  store.run("UPDATE stream_leases SET expires_at=0");
  assert.ok(store.lease("student:0", 2));
  assert.equal(store.get("SELECT COUNT(*) AS n FROM stream_leases").n, 1);
});

const credentials = new Map();
async function api(student, path = [], method = "GET", data, role = "", origin = process.env.CLASSROOM_PUBLIC_ORIGIN) {
  if (student && path[0] === "join" && role && !credentials.has(role)) await api(true, ["session"], "POST", {}, role, origin);
  const headers = { "Content-Type": "application/json", ...(credentials.get(role) ? { cookie: credentials.get(role) } : {}) };
  if (origin) headers.origin = origin;
  const response = await classroomHttp(new Request(`https://classroom.example/api/${student ? "classroom-participation" : "classrooms"}/${path.join("/")}`, { method, headers, body: method === "POST" ? JSON.stringify(data) : undefined }), path, student);
  if (response.headers.get("set-cookie")) credentials.set(role, response.headers.get("set-cookie").split(";")[0]);
  return response;
}
test("课堂 HTTP：访问码配置、来源/大小/参数校验、凭证隔离、二维码与学生响应白名单", async () => {
  const expected = process.env.CLASSROOM_TEACHER_ACCESS_CODE; delete process.env.CLASSROOM_TEACHER_ACCESS_CODE;
  assert.equal((await api(false, ["teacher-session"], "POST", { accessCode: "x" })).status, 503);
  process.env.CLASSROOM_TEACHER_ACCESS_CODE = expected;
  assert.equal((await api(false, ["teacher-session"], "POST", { accessCode: expected }, "t", "https://evil.example")).status, 403);
  assert.equal((await api(false, ["teacher-session"], "POST", { accessCode: "x" })).status, 403);
  const login = await api(false, ["teacher-session"], "POST", { accessCode: expected }, "t");
  assert.equal(login.status, 200); assert.match(login.headers.get("set-cookie"), /HttpOnly; SameSite=Lax; Path=/);
  assert.equal((await api(false)).status, 401);
  assert.equal((await api(false, [], "POST", { title: "a".repeat(20_000), requestId: randomUUID() }, "t")).status, 413);
  assert.equal((await api(false, [], "POST", { title: "", requestId: randomUUID() }, "t")).status, 400);
  const body = { title: "HTTP课堂", requestId: randomUUID() };
  const created = await api(false, [], "POST", body, "t"); assert.equal(created.status, 201);
  const c = (await created.json()).classroom;
  assert.equal((await api(true, ["join"], "POST", { code: c.code, name: "无设备会话" })).status, 401);
  assert.equal((await (await api(false, [], "POST", body, "t")).json()).classroom.id, c.id);
  const invite = await (await api(false, [c.id, "invite"], "GET", undefined, "t")).json();
  assert.equal(invite.url, joinUrl(c.code)); assert.match(invite.svg, /<svg/); assert.match(invite.svg, /shape-rendering="crispEdges"/);
  assert.ok(!JSON.stringify(invite).includes(expected));
  await api(false, ["teacher-session"], "POST", { accessCode: expected }, "otherTeacher");
  assert.equal((await api(false, [c.id], "GET", undefined, "otherTeacher")).status, 404);
  assert.equal((await api(true, ["join"], "POST", { code: c.code, name: "" }, "s")).status, 400);
  const joined = await api(true, ["join"], "POST", { code: c.code, name: "HTTP学生" }, "s"); assert.equal(joined.status, 200);
  // The join response can be completely lost: the previously acknowledged device
  // cookie makes a retry return the same participant without increasing the count.
  await api(true, ["join"], "POST", { code: c.code, name: "HTTP学生" }, "s");
  assert.equal((await (await api(false, [c.id], "GET", undefined, "t")).json()).participants.length, 1);
  assert.equal((await api(false, [c.id], "GET", undefined, "s")).status, 401);
  assert.equal((await api(true, [c.id], "GET", undefined, "t")).status, 401);
  await api(false, [c.id, "start"], "POST", {}, "t");
  const invalid = questions.find(q => !classroomCatalog().some(c => c.id === q.id));
  assert.equal((await api(false, [c.id, "rounds"], "POST", { questionId: invalid.id, requestId: randomUUID() }, "t")).status, 400);
  const question = q("choice");
  const round = (await (await api(false, [c.id, "rounds"], "POST", { questionId: question.id, requestId: randomUUID() }, "t")).json()).rounds[0];
  assert.equal(round.question.difficulty, classroomQuestion(question.id).difficulty);
  const submit = await api(true, [c.id, "rounds", round.id, "answer"], "POST", { answer: question.options[0].id, requestId: randomUUID() }, "s");
  assert.equal(submit.status, 200); assertRedacted(await submit.json(), question);
  await api(true, ["join"], "POST", { code: c.code, name: "另一学生" }, "otherStudent");
  const isolated = await (await api(true, [c.id], "GET", undefined, "otherStudent")).json(); assert.equal(isolated.rounds[0].submission, null);
  assert.equal((await api(true, [c.id, "rounds", round.id, "close"], "POST", {}, "s")).status, 404);
  const aborted = new AbortController();
  const streamResponse = await classroomHttp(new Request("https://classroom.example/events", { headers: { cookie: credentials.get("s") }, signal: aborted.signal }), [c.id, "events"], true);
  const iterator = readSseData(streamResponse.body)[Symbol.asyncIterator](); assertRedacted(JSON.parse((await iterator.next()).value), question);
  aborted.abort(); await iterator.return();
  await api(false, [c.id, "rounds", round.id, "close"], "POST", {}, "t");
  assertRedacted(await (await api(true, [c.id], "GET", undefined, "s")).json(), question);
  assert.equal((await api(true, [c.id, "rounds", round.id, "answer"], "POST", { answer: question.options[0].id, requestId: randomUUID() }, "s")).status, 409);
  await api(false, [c.id, "rounds", round.id, "reveal"], "POST", {}, "t");
  assert.equal((await (await api(true, [c.id], "GET", undefined, "s")).json()).rounds[0].answer, question.answer);
  await api(false, [c.id, "end"], "POST", {}, "t");
  assert.equal((await api(true, ["join"], "POST", { code: c.code, name: "迟到" }, "late")).status, 404);
});

test("课堂 URL 根路径/子路径、配置拒绝 localhost；学生代码与 SSR 不导入题库", () => {
  for (const prefix of ["", "/teachdemo", "/teachdemo/"]) assert.equal(new URL("https://edsionc.top" + withBasePath("/join/123456", prefix)).pathname, prefix.replace(/\/$/, "") + "/join/123456");
  const previous = process.env.CLASSROOM_PUBLIC_ORIGIN;
  for (const invalid of ["http://localhost:3000", "https://edsionc.top/teachdemo", "https://user:pass@example.com", "file:///tmp/test"]) {
    process.env.CLASSROOM_PUBLIC_ORIGIN = invalid; assert.throws(publicOrigin, ClassroomError);
  }
  process.env.CLASSROOM_PUBLIC_ORIGIN = previous;
  for (const file of ["src/components/StudentClassroom.tsx", "src/hooks/use-classroom.ts", "src/app/join/page.tsx", "src/app/join/[code]/page.tsx"]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /from\s+["'][^"']*(?:questions|question-catalog|classroom\/store|classroom\/catalog)["']/);
  }
});

test("课堂 Hook：旧版本和切换课堂后才完成的旧命令不能覆盖当前快照", () => {
  const h = hooks();
  const { useClassroom } = loadHook("src/hooks/use-classroom.ts", { react: h.react, "@/lib/app-path": { appPath: value => value } });
  const state = (id, version) => ({ classroom: { id, version }, rounds: [] });
  let live = h.render(() => useClassroom("first", false, false));
  live.accept(state("first", 2));
  live = h.render(() => useClassroom("first", false, false));
  live.accept(state("first", 1));
  live = h.render(() => useClassroom("first", false, false)); assert.equal(live.state.classroom.version, 2);
  const oldCommandCallback = live.accept;
  live = h.render(() => useClassroom("second", false, false)); live.accept(state("second", 3));
  oldCommandCallback(state("first", 999));
  live = h.render(() => useClassroom("second", false, false));
  assert.equal(live.state.classroom.id, "second"); assert.equal(live.state.classroom.version, 3);
});
