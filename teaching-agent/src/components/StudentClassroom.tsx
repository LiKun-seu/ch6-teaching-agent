"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Markdown } from "./Markdown";
import { appPath } from "@/lib/app-path";
import type { StudentSnapshot } from "@/lib/classroom/types";
import { classroomFetch, classroomRequestId, useClassroom } from "@/hooks/use-classroom";

export function StudentClassroom({ code: initialCode = "" }: { code?: string }) {
  const [code, setCode] = useState(initialCode), [name, setName] = useState(""), [studentNo, setStudentNo] = useState("");
  const [id, setId] = useState<string | null>(null), [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [draft, setDraft] = useState(""), [submissionStatus, setSubmissionStatus] = useState("");
  const retry = useRef<{ round: string; answer: string; id: string } | null>(null);
  const live = useClassroom<StudentSnapshot>(id, true, true);
  const current = live.state?.rounds.at(-1);
  const storageKey = `ch6-classroom:${appPath("/")}:${initialCode}`;
  useEffect(() => {
    if (initialCode) try { setId(localStorage.getItem(storageKey)); } catch { /* Cookie still handles repeat joins. */ }
    setReady(true);
  }, [initialCode, storageKey]);
  useEffect(() => {
    setDraft(current?.submission?.answer ?? ""); setSubmissionStatus(current?.submission ? "已提交" : ""); retry.current = null;
  }, [current?.id]); // Edits survive snapshots for the same round.
  const join = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await classroomFetch("/api/classroom-participation/session", {});
      const result = await classroomFetch<{ classroomId: string }>("/api/classroom-participation/join", { code, name, studentNo });
      try { localStorage.setItem(`ch6-classroom:${appPath("/")}:${code}`, result.classroomId); } catch { /* Persistence unavailable. */ }
      if (initialCode === code) setId(result.classroomId);
      else window.location.assign(appPath(`/join/${code}`));
    } catch (err) { setError(err instanceof Error ? err.message : "加入失败，请重试"); }
    finally { setBusy(false); }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (!current || !id) return;
    const answer = draft.trim();
    if (!retry.current || retry.current.round !== current.id || retry.current.answer !== answer) retry.current = { round: current.id, answer, id: classroomRequestId() };
    setBusy(true); setSubmissionStatus("提交中…"); setError("");
    try {
      const result = await classroomFetch<StudentSnapshot>(`/api/classroom-participation/${id}/rounds/${current.id}/answer`, { answer, requestId: retry.current.id });
      live.accept(result); setSubmissionStatus("已提交"); retry.current = null;
    } catch (err) { setSubmissionStatus("提交失败，请重试"); setError(err instanceof Error ? err.message : "提交失败，请重试"); }
    finally { setBusy(false); }
  };
  const reset = () => {
    try { localStorage.removeItem(storageKey); } catch { /* Persistence unavailable. */ }
    setId(null); setError("");
  };
  return <main className="mx-auto min-h-svh w-full max-w-2xl space-y-5 p-4 pb-12 sm:p-8">
    <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-xl font-semibold">学生入课</h1><Button variant="ghost" asChild><a href={appPath("/")}>返回学习</a></Button></header>
    {!ready ? <p role="status">正在恢复课堂…</p> : !id ? <Card>
      <CardHeader><CardTitle>加入实时课堂</CardTitle></CardHeader>
      <CardContent><form onSubmit={join} className="space-y-4">
        <label className="block space-y-2 text-sm">课堂码<Input name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={e => setCode(e.target.value)} autoComplete="off" /></label>
        <label className="block space-y-2 text-sm">姓名<Input name="name" maxLength={60} required value={name} onChange={e => setName(e.target.value)} autoComplete="name" /></label>
        <label className="block space-y-2 text-sm">学号（选填）<Input name="studentNo" maxLength={80} value={studentNo} onChange={e => setStudentNo(e.target.value)} /></label>
        <Button type="submit" disabled={busy || !name.trim() || !/^\d{6}$/.test(code)}>{busy ? "正在加入…" : "加入课堂"}</Button>
      </form></CardContent>
    </Card> : <>
      <p role="status" className="text-sm text-muted-foreground">{live.connection}<Button size="sm" variant="ghost" onClick={live.refresh}>重新同步</Button></p>
      {live.error ? <p role="alert" className="text-sm text-destructive">{live.error}</p> : null}
      {live.expired ? <Button onClick={reset}>重新入课</Button> : null}
      {live.state ? <>
        <div><h2 className="text-lg font-medium">{live.state.classroom.title}</h2><p className="mt-1 text-sm text-muted-foreground">{live.state.participant.name} · 课堂码 {live.state.classroom.code}</p></div>
        {live.state.classroom.status === "ended" ? <p role="status">课堂已结束，感谢参与。</p> : !current ? <p role="status">{live.state.classroom.status === "waiting" ? "已加入，等待老师开始上课。" : "等待老师发题。"}</p> : null}
        {current ? <Card role="region" aria-label="当前课堂题目"><CardHeader><CardTitle>第 {current.sequence} 题 · {current.question.type === "choice" ? "选择" : current.question.type === "judge" ? "判断" : "填空"}</CardTitle></CardHeader>
          <CardContent className="space-y-4"><Markdown text={current.question.prompt} />
            <form onSubmit={submit} className="space-y-4">
              {current.question.type === "fill" ? <label className="block space-y-2 text-sm">你的答案（多空用分号分隔）<Input aria-label="你的答案" maxLength={2000} value={draft} onChange={e => { setDraft(e.target.value); setSubmissionStatus("尚未提交修改"); }} disabled={current.status !== "open" || live.state.classroom.status === "ended" || busy} /></label> : <fieldset className="grid gap-2" disabled={current.status !== "open" || live.state.classroom.status === "ended" || busy}><legend className="sr-only">选择答案</legend>
                {(current.question.type === "judge" ? [{ id: "T", text: "正确" }, { id: "F", text: "错误" }] : current.question.options).map(o => <Button key={o.id} type="button" variant={draft === o.id ? "default" : "outline"} aria-pressed={draft === o.id} className="h-auto min-h-11 justify-start whitespace-normal text-left" onClick={() => { setDraft(o.id); setSubmissionStatus("尚未提交修改"); }}><span className="mr-2">{o.id}</span><Markdown text={o.text} /></Button>)}
              </fieldset>}
              {current.status === "open" && live.state.classroom.status !== "ended" ? <Button type="submit" disabled={busy || !draft.trim() || live.expired}>{busy ? "提交中…" : current.submission ? "修改并提交" : "提交答案"}</Button> : <p role="status">本题已收题{current.status === "revealed" ? "，答案已公布。" : "，等待老师公布。"}</p>}
              <p role="status" className="text-sm">{submissionStatus}{current.submission ? ` · 最近成功提交：${current.submission.answer}` : ""}</p>
            </form>
            {current.status === "revealed" ? <div className="space-y-3 border-t pt-4"><p>{current.submission?.grade === true ? "回答正确" : current.submission?.grade === false ? "回答有误" : current.submission ? "待教师核对" : "本轮未作答"}</p><Markdown text={`标准答案：${current.answer ?? ""}`} />{current.analysis ? <Markdown text={current.analysis} /> : null}</div> : null}
          </CardContent></Card> : null}
        {live.state.rounds.length > 1 ? <section className="space-y-3"><h2 className="font-medium">往轮记录</h2>{live.state.rounds.slice(0, -1).reverse().map(r => <Card key={r.id}><CardContent className="space-y-2 pt-5"><p>第 {r.sequence} 题 · {r.submission ? `我的答案：${r.submission.answer}` : "未作答"}</p><Markdown text={r.question.prompt} />{r.status === "revealed" ? <><Markdown text={`标准答案：${r.answer}`} />{r.analysis ? <Markdown text={r.analysis} /> : null}<p>{r.submission?.grade === true ? "回答正确" : r.submission?.grade === false ? "回答有误" : r.submission ? "待教师核对" : ""}</p></> : <p>答案尚未公布</p>}</CardContent></Card>)}</section> : null}
      </> : !live.error ? <p role="status">正在获取课堂…</p> : null}
    </>}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {id ? <Button variant="ghost" asChild><a href={appPath("/join")}>输入其他课堂码</a></Button> : null}
  </main>;
}
