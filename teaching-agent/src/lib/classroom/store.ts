import "server-only";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { grade } from "../grading";
import type { Question } from "../questions";
import type { ClassroomSummary, OwnSubmission, PublicQuestion, RoundView, StudentSnapshot, TeacherRound, TeacherSnapshot } from "./types";

export class ClassroomError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
export const digest = (token: string) => createHash("sha256").update(token).digest("hex");
const token = () => randomBytes(32).toString("base64url");
const DAY = 86_400_000;
export const TEACHER_AGE = 30 * DAY;
export const STUDENT_AGE = 7 * DAY;
type Row = Record<string, string | number | null>;
const conflict = (message: string): never => { throw new ClassroomError(message, 409); };
const summary = (c: Row): ClassroomSummary => ({
  id: String(c.id), code: String(c.code), title: String(c.title), status: c.status as ClassroomSummary["status"],
  version: Number(c.version), createdAt: Number(c.created_at),
});
const ownSubmission = (s: Row, reveal: boolean): OwnSubmission => ({
  answer: String(s.answer), revision: Number(s.revision), submittedAt: Number(s.submitted_at),
  ...(reveal ? { grade: s.grade === null ? null : Boolean(s.grade) } : {}),
});
export function publicQuestion(q: Question & { difficulty?: string }): PublicQuestion {
  return { id: q.id, type: q.type, prompt: q.prompt, options: (q.options ?? []).map(o => ({ id: o.id, text: o.text })),
    ...(q.difficulty ? { difficulty: q.difficulty } : {}) };
}

/** All durable state and stream leases live in SQLite; route bundles need no shared bus. */
export class ClassroomStore {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o750 });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;");
    this.tx(() => {
      const version = Number(this.get("PRAGMA user_version")?.user_version ?? 0);
      if (version > 1) throw new Error("课堂数据库版本高于本程序，拒绝写入；请恢复兼容的程序版本");
      if (version === 1) return;
      this.db.exec(`
        CREATE TABLE teacher_sessions (hash TEXT PRIMARY KEY, owner_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
        CREATE TABLE student_sessions (hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
        CREATE TABLE classrooms (
          id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, code TEXT NOT NULL, title TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('waiting','active','ended')),
          version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, ended_at INTEGER,
          request_id TEXT NOT NULL, UNIQUE(owner_id,request_id)
        );
        CREATE UNIQUE INDEX active_classroom_code ON classrooms(code) WHERE status != 'ended';
        CREATE INDEX classroom_owner ON classrooms(owner_id,created_at);
        CREATE TABLE participants (
          id TEXT PRIMARY KEY, classroom_id TEXT NOT NULL REFERENCES classrooms(id),
          session_hash TEXT NOT NULL REFERENCES student_sessions(hash), name TEXT NOT NULL, student_no TEXT NOT NULL,
          joined_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, UNIQUE(classroom_id,session_hash)
        );
        CREATE TABLE rounds (
          id TEXT PRIMARY KEY, classroom_id TEXT NOT NULL REFERENCES classrooms(id), sequence INTEGER NOT NULL,
          question_id TEXT NOT NULL, question TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('open','closed','revealed')),
          opened_at INTEGER NOT NULL, closed_at INTEGER, revealed_at INTEGER, request_id TEXT NOT NULL,
          UNIQUE(classroom_id,sequence), UNIQUE(classroom_id,request_id)
        );
        CREATE UNIQUE INDEX one_open_round ON rounds(classroom_id) WHERE status='open';
        CREATE TABLE submissions (
          round_id TEXT NOT NULL REFERENCES rounds(id), participant_id TEXT NOT NULL REFERENCES participants(id),
          answer TEXT NOT NULL, grade INTEGER, submitted_at INTEGER NOT NULL, revision INTEGER NOT NULL,
          PRIMARY KEY(round_id,participant_id)
        );
        CREATE TABLE answer_commands (
          round_id TEXT NOT NULL REFERENCES rounds(id), participant_id TEXT NOT NULL REFERENCES participants(id),
          request_id TEXT NOT NULL, PRIMARY KEY(round_id,participant_id,request_id)
        );
        CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);
        CREATE TABLE stream_leases (id TEXT PRIMARY KEY, session_key TEXT NOT NULL, expires_at INTEGER NOT NULL);
        CREATE INDEX lease_session ON stream_leases(session_key);
        PRAGMA user_version=1;
      `);
    });
  }
  close() { this.db.close(); }
  get(sql: string, ...args: SQLInputValue[]) { return this.db.prepare(sql).get(...args) as Row | undefined; }
  all(sql: string, ...args: SQLInputValue[]) { return this.db.prepare(sql).all(...args) as Row[]; }
  run(sql: string, ...args: SQLInputValue[]) { return this.db.prepare(sql).run(...args); }
  tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = fn(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  // A short read transaction prevents a close/reveal from mixing snapshot versions across bundles.
  read<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try { const result = fn(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  limit(key: string, maximum: number, windowMs = 60_000) {
    this.tx(() => {
      const now = Date.now();
      this.run("DELETE FROM rate_limits WHERE reset_at < ?", now);
      const row = this.get("SELECT * FROM rate_limits WHERE key=?", key);
      if (row && Number(row.count) >= maximum) throw new ClassroomError("操作过于频繁，请稍后重试", 429);
      this.run("INSERT INTO rate_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1", key, now + windowMs);
    });
  }
  teacher(raw?: string) {
    const row = raw && this.get("SELECT * FROM teacher_sessions WHERE hash=? AND expires_at>?", digest(raw), Date.now());
    if (!row) throw new ClassroomError("教师会话已过期，请重新验证", 401);
    return String(row.owner_id);
  }
  login(access: string, previous?: string) {
    const expected = process.env.CLASSROOM_TEACHER_ACCESS_CODE;
    if (!expected) throw new ClassroomError("尚未配置 CLASSROOM_TEACHER_ACCESS_CODE，请联系管理员", 503);
    if (!timingSafeEqual(Buffer.from(digest(access)), Buffer.from(digest(expected)))) throw new ClassroomError("教师访问码不正确", 403);
    if (previous) {
      try {
        this.teacher(previous);
        this.run("UPDATE teacher_sessions SET expires_at=? WHERE hash=?", Date.now() + TEACHER_AGE, digest(previous));
        return previous;
      } catch { /* Expired credentials cannot recover ownership. */ }
    }
    const raw = token();
    this.run("INSERT INTO teacher_sessions VALUES (?,?,?)", digest(raw), randomUUID(), Date.now() + TEACHER_AGE);
    return raw;
  }
  owned(owner: string, id: string) {
    const row = this.get("SELECT * FROM classrooms WHERE id=? AND owner_id=?", id, owner);
    if (!row) throw new ClassroomError("课堂不存在或不属于当前教师", 404);
    return row;
  }
  participant(raw: string | undefined, classroomId: string) {
    const row = raw && this.get(`SELECT p.* FROM participants p JOIN student_sessions s ON s.hash=p.session_hash
      WHERE p.classroom_id=? AND s.hash=? AND s.expires_at>?`, classroomId, digest(raw), Date.now());
    if (!row) throw new ClassroomError("入课会话已过期，请输入课堂码重新加入", 401);
    return row;
  }
  deviceSession(previous?: string) {
    if (previous && this.get("SELECT hash FROM student_sessions WHERE hash=? AND expires_at>?", digest(previous), Date.now())) return previous;
    const raw = token();
    this.run("INSERT INTO student_sessions VALUES (?,?)", digest(raw), Date.now() + STUDENT_AGE);
    return raw;
  }
  list(owner: string) { return this.all("SELECT * FROM classrooms WHERE owner_id=? ORDER BY (status='ended'),created_at DESC LIMIT 100", owner).map(summary); }
  create(owner: string, title: string, requestId: string) {
    return this.tx(() => {
      const prior = this.get("SELECT * FROM classrooms WHERE owner_id=? AND request_id=?", owner, requestId);
      if (prior) return summary(prior);
      if (Number(this.get("SELECT COUNT(*) AS n FROM classrooms WHERE owner_id=? AND status!='ended'", owner)?.n) >= 20) conflict("进行中的课堂过多，请先结束旧课堂");
      let code = "";
      for (let i = 0; i < 100; i++) {
        const candidate = String(randomInt(100000, 1000000));
        if (!this.get("SELECT id FROM classrooms WHERE code=? AND status!='ended'", candidate)) { code = candidate; break; }
      }
      if (!code) throw new ClassroomError("暂时无法分配课堂码，请重试", 503);
      const id = randomUUID();
      this.run("INSERT INTO classrooms(id,owner_id,code,title,status,created_at,request_id) VALUES (?,?,?,?,'waiting',?,?)", id, owner, code, title, Date.now(), requestId);
      return summary(this.owned(owner, id));
    });
  }
  bump(id: string) { this.run("UPDATE classrooms SET version=version+1 WHERE id=?", id); }
  join(code: string, name: string, studentNo: string, previous?: string) {
    return this.tx(() => {
      const classroom = this.get("SELECT * FROM classrooms WHERE code=? AND status!='ended'", code);
      if (!classroom) throw new ClassroomError("课堂码无效或课堂已结束，请向教师确认", 404);
      // Establish the HttpOnly device cookie in a separate acknowledged request first.
      // Losing the first join response must not create another participant on retry.
      const raw = previous;
      if (!raw || !this.get("SELECT hash FROM student_sessions WHERE hash=? AND expires_at>?", digest(raw), Date.now())) throw new ClassroomError("设备会话已过期，请重新入课", 401);
      let p = this.get("SELECT * FROM participants WHERE classroom_id=? AND session_hash=?", classroom.id, digest(raw));
      if (!p) {
        if (Number(this.get("SELECT COUNT(*) AS n FROM participants WHERE classroom_id=?", classroom.id)?.n) >= 200) conflict("课堂人数已满，请联系教师");
        const id = randomUUID(), now = Date.now();
        this.run("INSERT INTO participants VALUES (?,?,?,?,?,?,?)", id, classroom.id, digest(raw), name, studentNo, now, now);
        this.bump(String(classroom.id));
        p = this.get("SELECT * FROM participants WHERE id=?", id)!;
      }
      return { token: raw, classroomId: String(classroom.id), participantId: String(p.id) };
    });
  }
  start(owner: string, id: string) {
    this.tx(() => {
      const c = this.owned(owner, id);
      if (c.status === "ended") conflict("课堂已结束，不能重新开始");
      if (c.status === "active") return;
      this.run("UPDATE classrooms SET status='active',version=version+1 WHERE id=?", id);
    });
  }
  publish(owner: string, id: string, q: Question, requestId: string) {
    return this.tx(() => {
      const c = this.owned(owner, id);
      const prior = this.get("SELECT id FROM rounds WHERE classroom_id=? AND request_id=?", id, requestId);
      if (prior) return String(prior.id);
      if (c.status !== "active") conflict("请先开始课堂；已结束的课堂不能发题");
      if (this.get("SELECT id FROM rounds WHERE classroom_id=? AND status='open'", id)) conflict("请先收取当前题目");
      if (Number(this.get("SELECT COUNT(*) AS n FROM rounds WHERE classroom_id=?", id)?.n) >= 100) conflict("本课堂已达 100 轮，请结束后新建课堂");
      const roundId = randomUUID();
      const sequence = Number(this.get("SELECT COALESCE(MAX(sequence),0)+1 AS n FROM rounds WHERE classroom_id=?", id)?.n);
      this.run("INSERT INTO rounds(id,classroom_id,sequence,question_id,question,status,opened_at,request_id) VALUES (?,?,?,?,?,'open',?,?)", roundId, id, sequence, q.id, JSON.stringify(q), Date.now(), requestId);
      this.bump(id); return roundId;
    });
  }
  changeRound(owner: string, id: string, roundId: string, action: "close" | "reveal") {
    this.tx(() => {
      const c = this.owned(owner, id);
      const r = this.get("SELECT * FROM rounds WHERE id=? AND classroom_id=?", roundId, id);
      if (!r) throw new ClassroomError("轮次不存在", 404);
      if (action === "close" && r.status !== "open" || action === "reveal" && r.status === "revealed") return;
      if (c.status === "ended") conflict("课堂已结束，结果只读");
      if (action === "reveal" && r.status !== "closed") conflict("请先收题，再公布答案");
      if (action === "close") this.run("UPDATE rounds SET status='closed',closed_at=? WHERE id=?", Date.now(), roundId);
      else this.run("UPDATE rounds SET status='revealed',revealed_at=? WHERE id=?", Date.now(), roundId);
      this.bump(id);
    });
  }
  end(owner: string, id: string) {
    this.tx(() => {
      if (this.owned(owner, id).status === "ended") return;
      const now = Date.now();
      this.run("UPDATE rounds SET status='closed',closed_at=? WHERE classroom_id=? AND status='open'", now, id);
      this.run("UPDATE classrooms SET status='ended',ended_at=?,version=version+1 WHERE id=?", now, id);
    });
  }
  answer(raw: string | undefined, id: string, roundId: string, answer: string, requestId: string) {
    this.tx(() => {
      const p = this.participant(raw, id);
      const c = this.get("SELECT * FROM classrooms WHERE id=?", id)!;
      const r = this.get("SELECT * FROM rounds WHERE id=? AND classroom_id=?", roundId, id);
      if (!r) throw new ClassroomError("轮次不存在", 404);
      if (c.status !== "active" || r.status !== "open") conflict("本题已收题，答案不能再修改");
      if (this.get("SELECT request_id FROM answer_commands WHERE round_id=? AND participant_id=? AND request_id=?", roundId, p.id, requestId)) return;
      const q = JSON.parse(String(r.question)) as Question;
      if (q.type === "choice" && !q.options.some(o => o.id === answer) || q.type === "judge" && !["T", "F"].includes(answer)) throw new ClassroomError("请选择合法选项");
      const result = grade(q, answer);
      this.run(`INSERT INTO submissions VALUES (?,?,?,?,?,1) ON CONFLICT(round_id,participant_id)
        DO UPDATE SET answer=excluded.answer,grade=excluded.grade,submitted_at=excluded.submitted_at,revision=revision+1`, roundId, p.id, answer, result === null ? null : Number(result), Date.now());
      this.run("INSERT INTO answer_commands VALUES (?,?,?)", roundId, p.id, requestId);
      this.bump(id);
    });
  }
  roundView(r: Row, reveal: boolean): RoundView {
    const q = JSON.parse(String(r.question)) as Question;
    return { id: String(r.id), sequence: Number(r.sequence), status: r.status as RoundView["status"],
      question: publicQuestion(q), openedAt: Number(r.opened_at), ...(reveal ? { answer: q.answer, analysis: q.analysis } : {}) };
  }
  studentSnapshot(raw: string | undefined, id: string): StudentSnapshot {
    return this.read(() => {
      const p = this.participant(raw, id);
      const c = this.get("SELECT * FROM classrooms WHERE id=?", id)!;
      return { classroom: summary(c), participant: { id: String(p.id), name: String(p.name) },
        rounds: this.all("SELECT * FROM rounds WHERE classroom_id=? ORDER BY sequence", id).map(r => {
          const reveal = r.status === "revealed";
          const s = this.get("SELECT * FROM submissions WHERE round_id=? AND participant_id=?", r.id, p.id);
          return { ...this.roundView(r, reveal), submission: s ? ownSubmission(s, reveal) : null };
        }) };
    });
  }
  teacherSnapshot(owner: string, id: string): TeacherSnapshot {
    return this.read(() => {
      const c = this.owned(owner, id);
      const participants = this.all("SELECT * FROM participants WHERE classroom_id=? ORDER BY joined_at,id", id).map(p => ({
        id: String(p.id), name: String(p.name), studentNo: String(p.student_no), joinedAt: Number(p.joined_at),
      }));
      const rounds: TeacherRound[] = this.all("SELECT * FROM rounds WHERE classroom_id=? ORDER BY sequence", id).map(r => {
        const submissions = this.all(`SELECT s.*,p.name,p.student_no FROM submissions s JOIN participants p ON p.id=s.participant_id WHERE s.round_id=?`, r.id)
          .map(s => ({ ...ownSubmission(s, true), participantId: String(s.participant_id), name: String(s.name), studentNo: String(s.student_no) }));
        const distribution: Record<string, number> = {};
        const q = JSON.parse(String(r.question)) as Question;
        if (q.type !== "fill") for (const s of submissions) distribution[s.answer] = (distribution[s.answer] ?? 0) + 1;
        return { ...this.roundView(r, true), submissions, stats: { submitted: submissions.length, unanswered: participants.length - submissions.length,
          correct: submissions.filter(s => s.grade === true).length, incorrect: submissions.filter(s => s.grade === false).length,
          pending: submissions.filter(s => s.grade === null).length, distribution } };
      });
      return { classroom: summary(c), participants, rounds };
    });
  }
  lease(sessionKey: string, maximum: number) {
    return this.tx(() => {
      const now = Date.now();
      this.run("DELETE FROM stream_leases WHERE expires_at<=?", now);
      if (Number(this.get("SELECT COUNT(*) AS n FROM stream_leases WHERE session_key=?", sessionKey)?.n) >= maximum ||
          Number(this.get("SELECT COUNT(*) AS n FROM stream_leases")?.n) >= 256) throw new ClassroomError("实时连接已满，已切换为定时同步", 429);
      const id = randomUUID(); this.run("INSERT INTO stream_leases VALUES (?,?,?)", id, sessionKey, now + 45_000); return id;
    });
  }
}

let cached: ClassroomStore | undefined;
export function classroomStore() {
  if (process.env.NODE_ENV === "production" && (!process.env.CLASSROOM_DB_PATH || !isAbsolute(process.env.CLASSROOM_DB_PATH))) {
    throw new ClassroomError("请配置绝对路径 CLASSROOM_DB_PATH，指向跨发布保留的持久目录", 503);
  }
  return cached ??= new ClassroomStore(process.env.CLASSROOM_DB_PATH || resolve(".data/classroom/classroom.sqlite"));
}
