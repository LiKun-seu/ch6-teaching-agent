"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Radio, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Markdown } from "./Markdown";
import { appPath } from "@/lib/app-path";
import { ClassroomApiError, classroomFetch, classroomRequestId, useClassroom } from "@/hooks/use-classroom";
import type { ClassroomSummary, PublicQuestion, TeacherSnapshot } from "@/lib/classroom/types";

const difficultyLabel: Record<string, string> = { easy: "简单", medium: "中等", hard: "困难" };

export function ClassroomView({ active = true }: { active?: boolean }) {
  const [auth, setAuth] = useState<"checking" | "anonymous" | "ready">("checking");
  const [configured, setConfigured] = useState(true);
  const [accessCode, setAccessCode] = useState(""), [title, setTitle] = useState("");
  const [classrooms, setClassrooms] = useState<ClassroomSummary[]>([]), [id, setId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<PublicQuestion[]>([]), [questionId, setQuestionId] = useState("");
  const [type, setType] = useState("all"), [difficulty, setDifficulty] = useState("all");
  const [invite, setInvite] = useState<{ url: string; svg: string } | null>(null), [inviteError, setInviteError] = useState("");
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [confirmEnd, setConfirmEnd] = useState(false);
  const pending = useRef<{ key: string; id: string } | null>(null);
  const live = useClassroom<TeacherSnapshot>(id, false, active && auth === "ready");
  const c = live.state?.classroom, current = live.state?.rounds.at(-1);
  const [roundId, setRoundId] = useState("");
  const displayed = live.state?.rounds.find(r => r.id === roundId) ?? current;
  const filtered = catalog.filter(q => (type === "all" || q.type === type) && (difficulty === "all" || q.difficulty === difficulty));
  const question = catalog.find(q => q.id === questionId);
  const refreshList = useCallback(async (signal?: AbortSignal) => {
    const result = await classroomFetch<{ classrooms: ClassroomSummary[] }>("/api/classrooms", undefined, signal);
    setClassrooms(result.classrooms); setAuth("ready");
    return result.classrooms;
  }, []);
  useEffect(() => {
    if (!active) return;
    const abort = new AbortController();
    void classroomFetch<{ configured: boolean }>("/api/classrooms/teacher-session", undefined, abort.signal).then(result => setConfigured(result.configured)).catch(() => {});
    void refreshList(abort.signal).then(list => {
      let previous: string | null = null;
      try { previous = localStorage.getItem(`ch6-teacher-classroom:${appPath("/")}`); } catch { /* Storage unavailable. */ }
      setId(prior => prior ?? (list.some(c => c.id === previous) ? previous : null));
      setError("");
    }).catch(err => {
      if (abort.signal.aborted) return;
      if (err instanceof ClassroomApiError && err.status === 401) setAuth("anonymous");
      else setError(err instanceof Error ? err.message : "获取课堂失败");
    });
    return () => abort.abort();
  }, [active, refreshList]);
  useEffect(() => {
    if (!active || auth !== "ready") return;
    const abort = new AbortController();
    void classroomFetch<{ questions: PublicQuestion[] }>("/api/classrooms/catalog", undefined, abort.signal).then(result => setCatalog(result.questions)).catch(err => { if (!abort.signal.aborted) setError(err.message); });
    return () => abort.abort();
  }, [active, auth]);
  useEffect(() => {
    setRoundId(""); setInvite(null); setInviteError("");
    if (id) try { localStorage.setItem(`ch6-teacher-classroom:${appPath("/")}`, id); } catch { /* Storage unavailable. */ }
  }, [id]);
  useEffect(() => {
    if (!active || !id || auth !== "ready") return;
    const abort = new AbortController();
    void classroomFetch<{ url: string; svg: string }>(`/api/classrooms/${id}/invite`, undefined, abort.signal).then(setInvite).catch(err => { if (!abort.signal.aborted) setInviteError(err.message); });
    return () => abort.abort();
  }, [active, id, auth]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(""); setNotice("");
    try { await fn(); }
    catch (err) { setError(err instanceof Error ? err.message : "操作失败，请重试"); }
    finally { setBusy(false); }
  };
  const login = (event: React.FormEvent) => {
    event.preventDefault(); void run(async () => {
      await classroomFetch("/api/classrooms/teacher-session", { accessCode }); setAccessCode(""); await refreshList();
    });
  };
  const commandId = (key: string) => {
    if (pending.current?.key !== key) pending.current = { key, id: classroomRequestId() };
    return pending.current.id;
  };
  const create = (event: React.FormEvent) => {
    event.preventDefault(); void run(async () => {
      const result = await classroomFetch<{ classroom: ClassroomSummary }>("/api/classrooms", { title, requestId: commandId("create:" + title) });
      pending.current = null; setId(result.classroom.id); setTitle(""); await refreshList();
    });
  };
  const command = (action: string, data: Record<string, unknown> = {}) => void run(async () => {
    const payload = action === "rounds" ? { ...data, requestId: commandId(`${id}:${action}:${JSON.stringify(data)}`) } : data;
    const result = await classroomFetch<TeacherSnapshot>(`/api/classrooms/${id}/${action}`, payload);
    live.accept(result); pending.current = null; setConfirmEnd(false); setRoundId(""); await refreshList();
  });
  return <div className="mx-auto w-full max-w-6xl space-y-6 p-4 pb-12 sm:p-8">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="flex items-center gap-2 text-xl font-semibold"><Radio className="size-5" />实时课堂</h1><p className="mt-1 text-sm text-muted-foreground">开课、邀请学生，实时收集课堂作答。</p></div><Button asChild variant="outline"><a href={appPath("/join")}>学生入课</a></Button></header>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {notice ? <p role="status" className="text-sm">{notice}</p> : null}
    {auth !== "ready" ? <Card><CardHeader><CardTitle>教师验证</CardTitle></CardHeader><CardContent>
      <form className="flex max-w-md flex-col gap-3" onSubmit={login}>{!configured ? <p role="alert" className="text-sm text-destructive">尚未配置 CLASSROOM_TEACHER_ACCESS_CODE，请联系管理员。</p> : null}<label className="space-y-2 text-sm">教师访问码<Input type="password" autoComplete="current-password" maxLength={256} value={accessCode} onChange={e => setAccessCode(e.target.value)} required /></label><p className="text-sm text-muted-foreground">访问码由管理员配置。验证后可恢复本设备上尚在有效期内的教师课堂。</p><Button disabled={busy || !accessCode.trim() || !configured}>{busy ? "验证中…" : "验证并进入"}</Button></form>
    </CardContent></Card> : <>
      <div className="grid gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="space-y-4"><Card><CardHeader><CardTitle className="text-base">新建课堂</CardTitle></CardHeader><CardContent><form className="space-y-3" onSubmit={create}><label className="block space-y-2 text-sm">课堂标题<Input required maxLength={100} value={title} onChange={e => setTitle(e.target.value)} placeholder="例如：第六章·正截面受弯" /></label><Button disabled={busy || !title.trim()} type="submit">创建课堂</Button></form></CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">我的课堂</CardTitle></CardHeader><CardContent className="space-y-2">{classrooms.length ? classrooms.map(item => <Button key={item.id} variant={item.id === id ? "secondary" : "ghost"} className="h-auto w-full flex-col items-start whitespace-normal text-left" onClick={() => { setId(item.id); setError(""); }}><span>{item.title}</span><span className="text-xs text-muted-foreground">{item.code} · {item.status === "waiting" ? "待上课" : item.status === "active" ? "上课中" : "已结束"}</span></Button>) : <p className="text-sm text-muted-foreground">创建第一堂课，邀请学生加入。</p>}</CardContent></Card>
        </aside>
        <section className="min-w-0 space-y-5">
          {!id ? <p className="py-8 text-muted-foreground">选择或创建课堂，开始课堂互动。</p> : <>
            <p role="status" className="text-sm text-muted-foreground">{live.connection}<Button size="sm" variant="ghost" onClick={live.refresh}>重新同步</Button>{live.expired ? <Button size="sm" onClick={() => { setAuth("anonymous"); setId(null); }}>重新验证</Button> : null}</p>
            {live.error ? <p role="alert" className="text-sm text-destructive">{live.error}</p> : null}
            {c ? <>
              <Card><CardHeader><CardTitle>{c.title}</CardTitle></CardHeader><CardContent className="space-y-4">
                <div className="flex flex-wrap items-start gap-5">{invite && c.status !== "ended" ? <img width={180} height={180} className="size-44 rounded-md border" alt="学生入课二维码" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(invite.svg)}`} /> : null}
                  <div className="min-w-0 flex-1 space-y-3"><p className="text-sm text-muted-foreground">课堂码</p><p className="text-3xl font-semibold tracking-[0.2em]">{c.code}</p><p className="flex items-center gap-2 text-sm"><Users className="size-4" />已加入 {live.state!.participants.length} 人</p>
                    {invite && c.status !== "ended" ? <><Input aria-label="学生入课链接" readOnly value={invite.url} onFocus={e => e.target.select()} /><Button variant="outline" size="sm" onClick={() => { if (!navigator.clipboard) setNotice("请选中上方入课链接手动复制"); else void navigator.clipboard.writeText(invite.url).then(() => setNotice("入课链接已复制")).catch(() => setNotice("请选中上方入课链接手动复制")); }}><Copy className="size-4" />复制入课链接</Button></> : null}
                    {inviteError ? <p role="alert" className="text-sm text-destructive">{inviteError}</p> : null}
                  </div></div>
                <div className="flex flex-wrap gap-2">{c.status === "waiting" ? <Button disabled={busy} onClick={() => command("start")}>开始上课</Button> : null}{c.status !== "ended" ? <Button variant="outline" disabled={busy} onClick={() => setConfirmEnd(true)}>结束课堂</Button> : <p>课堂已结束，以下为只读记录。</p>}</div>
              </CardContent></Card>
              {c.status === "active" ? <Card><CardHeader><CardTitle className="text-base">从题库发题</CardTitle></CardHeader><CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2"><Select value={type} onValueChange={v => { setType(v); setQuestionId(""); }}><SelectTrigger className="w-32" aria-label="题型筛选"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部题型</SelectItem><SelectItem value="choice">选择</SelectItem><SelectItem value="judge">判断</SelectItem><SelectItem value="fill">填空</SelectItem></SelectContent></Select>
                  <Select value={difficulty} onValueChange={v => { setDifficulty(v); setQuestionId(""); }}><SelectTrigger className="w-32" aria-label="难度筛选"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部难度</SelectItem>{[...new Set(catalog.map(q => q.difficulty).filter((d): d is string => Boolean(d)))].map(d => <SelectItem key={d} value={d}>{difficultyLabel[d] ?? d}</SelectItem>)}</SelectContent></Select></div>
                <Select value={questionId} onValueChange={setQuestionId}><SelectTrigger aria-label="选择课堂题目"><SelectValue placeholder={`选择已复核题目（${filtered.length}）`} /></SelectTrigger><SelectContent>{filtered.map(q => <SelectItem key={q.id} value={q.id}>{q.id} · {q.prompt.slice(0, 70)}</SelectItem>)}</SelectContent></Select>
                {question ? <Markdown text={question.prompt} /> : null}
                <Button disabled={busy || !questionId || current?.status === "open"} onClick={() => command("rounds", { questionId })}>发布题目</Button>{current?.status === "open" ? <p className="text-sm text-muted-foreground">当前题目收题后可发布下一题。</p> : null}
              </CardContent></Card> : null}
              {displayed ? <Card><CardHeader><CardTitle className="text-base">第 {displayed.sequence} 轮 · {displayed.status === "open" ? "正在作答" : displayed.status === "closed" ? "已收题" : "已公布"}</CardTitle></CardHeader><CardContent className="space-y-4">
                <Select value={displayed.id} onValueChange={setRoundId}><SelectTrigger aria-label="查看轮次"><SelectValue /></SelectTrigger><SelectContent>{live.state!.rounds.map(r => <SelectItem key={r.id} value={r.id}>第 {r.sequence} 轮 · {r.question.id}</SelectItem>)}</SelectContent></Select>
                <Markdown text={displayed.question.prompt} />
                <p role="status">已答 {displayed.stats.submitted} · 未答 {displayed.stats.unanswered} · 答对 {displayed.stats.correct} · 答错 {displayed.stats.incorrect} · 待核对 {displayed.stats.pending}</p>
                {displayed.question.type !== "fill" ? <ul className="space-y-2">{(displayed.question.type === "judge" ? [{ id: "T", text: "正确" }, { id: "F", text: "错误" }] : displayed.question.options).map(o => <li key={o.id} className="flex gap-3 text-sm"><span>{o.id}：{displayed.stats.distribution[o.id] ?? 0} 人</span><Markdown text={o.text} /></li>)}</ul> : null}
                <div className="flex flex-wrap gap-2">{c.status !== "ended" && displayed.status === "open" ? <Button disabled={busy} onClick={() => command(`rounds/${displayed.id}/close`)}>收题</Button> : null}{c.status !== "ended" && displayed.status === "closed" ? <Button disabled={busy} onClick={() => command(`rounds/${displayed.id}/reveal`)}>公布答案与解析</Button> : null}</div>
                <details><summary className="cursor-pointer text-sm">教师答案与解析</summary><div className="space-y-2 pt-3"><Markdown text={`标准答案：${displayed.answer ?? ""}`} />{displayed.analysis ? <Markdown text={displayed.analysis} /> : null}</div></details>
                <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">学生作答名单</caption><thead><tr className="border-b"><th className="p-2">姓名 / 学号</th><th className="p-2">答案</th><th className="p-2">状态</th></tr></thead><tbody>{live.state!.participants.map(p => { const s = displayed.submissions.find(s => s.participantId === p.id); return <tr key={p.id} className="border-b"><td className="p-2">{p.name}{p.studentNo ? ` / ${p.studentNo}` : ""}</td><td className="max-w-sm whitespace-pre-wrap break-words p-2">{s?.answer ?? "—"}</td><td className="whitespace-nowrap p-2">{!s ? "未答" : s.grade === true ? "答对" : s.grade === false ? "答错" : "待核对"}</td></tr>; })}</tbody></table></div>
              </CardContent></Card> : live.state!.participants.length ? <Card><CardHeader><CardTitle className="text-base">已加入名单</CardTitle></CardHeader><CardContent><ul className="space-y-2 text-sm">{live.state!.participants.map(p => <li key={p.id}>{p.name}{p.studentNo ? ` / ${p.studentNo}` : ""}</li>)}</ul></CardContent></Card> : null}
            </> : !live.error ? <p>正在获取课堂…</p> : null}
          </>}
        </section>
      </div>
    </>}
    <Dialog open={confirmEnd} onOpenChange={setConfirmEnd}><DialogContent><DialogHeader><DialogTitle>结束这堂课？</DialogTitle><DialogDescription>结束后停止加入和作答，当前题目自动收题。课堂记录仍可查看。</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setConfirmEnd(false)}>继续上课</Button><Button disabled={busy} onClick={() => command("end")}>确认结束</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
