import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { readSseData } from "../src/lib/sse.ts";

const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/+$/, "");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "classroom-load-"));
const output = path.resolve("test-results", "classroom-load" + (basePath ? "-subpath" : "-root"));
fs.mkdirSync(output, { recursive: true });
const port = 3137, endpoint = `http://127.0.0.1:${port}${basePath}`, publicOrigin = "https://classroom.load.example";
let peakRss = 0, server, teacherCookie = "";
const streams = [], controllers = [];
const log = fs.createWriteStream(path.join(output, "server.log"));
const timeout = setTimeout(() => { server?.kill(); process.exit(1); }, 120_000);
async function start() {
  server = spawn(process.execPath, ["--require", "./tests/fixtures/classroom-memory.cjs", "node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    env: { ...process.env, CLASSROOM_DB_PATH: path.join(directory, "classroom.sqlite"), CLASSROOM_PUBLIC_ORIGIN: publicOrigin, CLASSROOM_TEACHER_ACCESS_CODE: "load-test-only", NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  server.stdout.pipe(log, { end: false }); server.stderr.pipe(log, { end: false });
  server.on("message", message => { peakRss = Math.max(peakRss, message.rss || 0); });
  for (let i = 0; i < 100; i++) {
    assert.equal(server.exitCode, null, "Production process exited unexpectedly");
    try { if ((await fetch(endpoint + "/api/health")).ok) return; } catch {}
    await delay(100);
  }
  throw new Error("Production server failed to start");
}
async function stop() {
  if (server && server.exitCode === null) { const exited = once(server, "exit"); server.kill(); await exited; }
}
async function request(url, data, cookie = teacherCookie) {
  const response = await fetch(endpoint + url, { method: data === undefined ? "GET" : "POST", headers: { origin: publicOrigin, "Content-Type": "application/json", cookie }, body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(15_000) });
  const body = await response.json();
  assert.ok(response.ok, `${url}: ${response.status} ${JSON.stringify(body)}`);
  return { data: body, cookie: response.headers.get("set-cookie")?.split(";")[0] || cookie };
}
const p95 = values => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
async function waitUntil(fn, timeoutMs = 10_000) {
  const start = performance.now();
  while (!fn()) { if (performance.now() - start > timeoutMs) throw new Error("Timed out waiting for all 100 students"); await delay(20); }
}
try {
  await start();
  teacherCookie = (await request("/api/classrooms/teacher-session", { accessCode: "load-test-only" }, "")).cookie;
  const c = (await request("/api/classrooms", { title: "100 students load test", requestId: randomUUID() })).data.classroom;
  const students = await Promise.all(Array.from({ length: 100 }, async (_, i) => {
    const session = await request("/api/classroom-participation/session", {}, "");
    const joined = await request("/api/classroom-participation/join", { code: c.code, name: "Synthetic student " + i }, session.cookie);
    return { cookie: joined.cookie, state: null, heartbeat: false, observedAt: 0 };
  }));
  await request(`/api/classrooms/${c.id}/start`, {});
  for (const student of students) {
    const abort = new AbortController(); controllers.push(abort);
    const response = await fetch(endpoint + `/api/classroom-participation/${c.id}/events`, { headers: { cookie: student.cookie }, signal: abort.signal });
    assert.equal(response.status, 200, "All 100 students must receive a live stream behind one NAT IP");
    const task = (async () => {
      for await (const data of readSseData(response.body, abort.signal)) {
        const snapshot = JSON.parse(data);
        if (!snapshot.classroom) { student.heartbeat = true; continue; }
        if (student.state) assert.ok(snapshot.classroom.version >= student.state.classroom.version, "Versions must be monotonic");
        assert.equal(snapshot.participants, undefined);
        for (const round of snapshot.rounds) {
          if (round.status !== "revealed") { assert.equal(round.answer, undefined); assert.equal(round.analysis, undefined); assert.equal(round.submission?.grade, undefined); }
        }
        student.state = snapshot; student.observedAt = performance.now();
      }
    })();
    task.catch(() => {}); streams.push(task);
  }
  await waitUntil(() => students.every(s => s.state));
  const question = (await request("/api/classrooms/catalog")).data.questions.find(q => q.type === "choice");
  const publishStart = performance.now();
  const published = (await request(`/api/classrooms/${c.id}/rounds`, { questionId: question.id, requestId: randomUUID() })).data;
  const round = published.rounds.at(-1);
  await waitUntil(() => students.every(s => s.state.rounds.at(-1)?.id === round.id));
  const updateLatencies = students.map(s => s.observedAt - publishStart);
  const submissionLatencies = await Promise.all(students.map(async student => {
    const started = performance.now();
    const result = await request(`/api/classroom-participation/${c.id}/rounds/${round.id}/answer`, { answer: question.options[0].id, requestId: randomUUID() }, student.cookie);
    assert.equal(result.data.rounds.at(-1).submission.revision, 1);
    return performance.now() - started;
  }));
  const final = (await request(`/api/classrooms/${c.id}`)).data;
  assert.equal(final.participants.length, 100); assert.equal(final.rounds[0].stats.submitted, 100);
  // Exercise real idle heartbeats (not a mocked clock) before shutting the connections down.
  await waitUntil(() => students.every(s => s.heartbeat), 25_000);
  for (const controller of controllers) controller.abort(); await Promise.allSettled(streams);
  await stop(); await start();
  const recovered = (await request(`/api/classrooms/${c.id}`)).data;
  assert.equal(recovered.rounds[0].stats.submitted, 100); assert.equal(recovered.participants.length, 100);
  await request(`/api/classrooms/${c.id}/rounds/${round.id}/close`, {});
  await request(`/api/classrooms/${c.id}/rounds/${round.id}/reveal`, {});
  await request(`/api/classrooms/${c.id}/end`, {});
  const report = { date: new Date().toISOString(), node: process.version, os: `${os.platform()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0].model, students: 100, basePath: basePath || "/", transport: "Next production HTTP + 100 concurrent SSE streams, same NAT, temporary SQLite WAL", updateP95Ms: Math.round(p95(updateLatencies)), submitP95Ms: Math.round(p95(submissionLatencies)), submitted: recovered.rounds[0].stats.submitted, peakRssMiB: Math.round(peakRss / 1024 / 1024), heartbeat: "100/100", restartRecovery: true };
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  assert.ok(report.updateP95Ms <= 2000, "State update p95 must meet 2 seconds");
  assert.ok(peakRss <= 512 * 1024 * 1024, "Production RSS must fit the 512 MiB systemd limit");
} finally {
  for (const controller of controllers) controller.abort();
  await Promise.allSettled(streams); await stop(); clearTimeout(timeout); log.end();
  fs.rmSync(directory, { recursive: true, force: true });
}
