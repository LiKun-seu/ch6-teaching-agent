"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { BookOpenCheck, Check, Download, Printer, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Markdown } from "./Markdown";
import { getQuestionCatalog, DIFFICULTY_LABELS, QUESTION_TYPE_LABELS, type QuestionDifficulty } from "@/lib/question-catalog";
import type { Question } from "@/lib/questions";
import { answerLabel, answerSession, createSession, DEFAULT_SETTINGS, displayPrompt, filterQuestions, parseQuestionCount, sampleQuestions, submitSession, summarizeSession, type TestSession } from "@/lib/self-test/model";
import { sessionStore } from "@/lib/self-test/store";
import { applySessionErrors, sessionWrongRecords } from "@/lib/wrongbook/model";
import { wrongbookStore } from "@/lib/wrongbook/store";
import { exportMarkdown, selectExportRecords, SCOPE_LABELS, TEMPLATE_LABELS, type ExportScope, type ExportTemplate } from "@/lib/wrongbook/export";
import { downloadMarkdown, printWrongbook } from "@/lib/wrongbook/browser-export";

const TYPES = Object.keys(QUESTION_TYPE_LABELS) as Question["type"][];
const LEVELS = Object.keys(DIFFICULTY_LABELS) as QuestionDifficulty[];
const STATUS_LABELS = { correct: "答对", wrong: "答错", pending: "待核对", unanswered: "未作答" };
const toggle = <T,>(values: T[], value: T) => values.includes(value) ? values.filter(item => item !== value) : [...values, value];
const percent = (value: number) => `${Math.round(value * 100)}%`;

/** 业务页面组合仓库已有 shadcn 控件；可独立挂载，不需要 AI/聊天 Provider。 */
export function SelfTestView() {
  const saved = useSyncExternalStore(sessionStore.subscribe, sessionStore.getSnapshot, sessionStore.getSnapshot);
  const book = useSyncExternalStore(wrongbookStore.subscribe, wrongbookStore.getSnapshot, wrongbookStore.getSnapshot);
  const session = saved.value;
  const [tab, setTab] = useState<"test" | "wrongbook">("test");
  const [showSettings, setShowSettings] = useState(false);
  const [countText, setCountText] = useState("10");
  const [types, setTypes] = useState(DEFAULT_SETTINGS.types);
  const [levels, setLevels] = useState(DEFAULT_SETTINGS.difficulties);
  const [bookType, setBookType] = useState("all");
  const [bookLevel, setBookLevel] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [scope, setScope] = useState<ExportScope>("session");
  const [template, setTemplate] = useState<ExportTemplate>("correction");
  const [limit, setLimit] = useState("all");
  const [confirmation, setConfirmation] = useState<{ kind: "submit" | "replace"; next?: TestSession } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  useEffect(() => { void sessionStore.initialize(); void wrongbookStore.initialize(); }, []);
  useEffect(() => {
    if (session?.status === "submitted" && book.writable && !book.value.appliedSessionIds.includes(session.id)) {
      void wrongbookStore.update(state => applySessionErrors(state, session));
    }
  }, [session, book.writable, book.value.appliedSessionIds]);
  const available = useMemo(() => filterQuestions(getQuestionCatalog(), { types, difficulties: levels }), [types, levels]);
  const count = parseQuestionCount(countText);
  const settingError = !types.length ? "请至少选择一种题型" : !levels.length ? "请至少选择一种难度" : !count ? "题量须为正整数" : !available.length ? "当前题型和难度没有已复核、答案及结构完整的题目" : count > available.length ? `当前条件仅有 ${available.length} 题` : null;
  const filteredRecords = book.value.records.filter(r => (bookType === "all" || r.question.type === bookType) && (bookLevel === "all" || r.question.difficulty === bookLevel));
  const thisWrong = useMemo(() => sessionWrongRecords(session), [session]);
  const exportRecords = selectExportRecords(scope === "session" ? thisWrong : book.value.records, scope, selected, thisWrong.map(r => r.questionId), limit === "all" ? null : Number(limit) as 10 | 20);
  const canReplace = session?.status !== "submitted" || book.writable && !book.dirty && book.value.appliedSessionIds.includes(session.id);
  const replace = (next: TestSession) => {
    if (!canReplace) { setMessage("最近结果尚未完整保存到错题本，请先重试读取或保存错题本，再开始新自测。"); return; }
    if (session?.status === "answering") setConfirmation({ kind: "replace", next });
    else { void sessionStore.update(() => next); setShowSettings(false); setTab("test"); }
  };
  const submit = () => { void sessionStore.update(current => current ? submitSession(current) : current); setConfirmation(null); };
  const runExport = async (print: boolean) => {
    setMessage(null);
    try {
      const output = exportMarkdown(exportRecords, template, scope);
      if (print) { setExporting(true); await printWrongbook(output.markdown, output.filename); }
      else downloadMarkdown(output.markdown, output.filename);
    } catch (error) { setMessage(error instanceof Error ? error.message : "导出失败，请重试"); }
    finally { setExporting(false); }
  };
  const question = session?.questions[session.cursor];
  const summary = session ? summarizeSession(session) : null;
  const unanswered = session?.questions.filter(q => !(session.answers[q.id] ?? "").trim()) ?? [];
  const renderExport = () => <Card><CardHeader><CardTitle className="text-lg">错题导出</CardTitle></CardHeader><CardContent className="space-y-3">
    <p className="text-sm text-muted-foreground">内容来自所选作答版本的题目快照。打印会打开浏览器打印对话框，可选择「另存为 PDF」。</p>
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="space-y-1 text-sm">导出范围<Select value={scope} onValueChange={value => setScope(value as ExportScope)}><SelectTrigger aria-label="导出范围"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(SCOPE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></label>
      <label className="space-y-1 text-sm">模板<Select value={template} onValueChange={value => setTemplate(value as ExportTemplate)}><SelectTrigger aria-label="导出模板"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(TEMPLATE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></label>
      <label className="space-y-1 text-sm">题数<Select value={limit} onValueChange={setLimit}><SelectTrigger aria-label="导出题数"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="10">最近 10 题</SelectItem><SelectItem value="20">最近 20 题</SelectItem><SelectItem value="all">全部</SelectItem></SelectContent></Select></label>
    </div>
    <p className="text-sm" role="status">{exportRecords.length ? `已选 ${exportRecords.length} 题，按最近答错时间倒序。${template === "blank" ? "空白重练只含题目与作答留白。" : ""}` : "当前范围没有错题，请更换范围或勾选题目"}</p>
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!exportRecords.length || exporting} onClick={() => void runExport(false)}><Download />下载 Markdown</Button><Button disabled={!exportRecords.length || exporting} onClick={() => void runExport(true)}><Printer />{exporting ? "准备打印…" : "浏览器打印 / 另存为 PDF"}</Button></div>
  </CardContent></Card>;
  return <main className="mx-auto w-full max-w-4xl space-y-5 px-3 py-6 sm:px-6" aria-label="题库自测">
    <div className="space-y-2"><h1 className="flex items-center gap-2 text-2xl font-semibold"><BookOpenCheck aria-hidden />题库自测</h1><p className="text-sm text-muted-foreground">从已复核题库随机组卷；交卷后统一查看答案、解析和错题。自测与错题只保存在本设备。</p></div>
    <div className="flex flex-wrap gap-2" role="group" aria-label="自测页面"><Button variant={tab === "test" ? "default" : "outline"} aria-pressed={tab === "test"} onClick={() => setTab("test")}>自测</Button><Button variant={tab === "wrongbook" ? "default" : "outline"} aria-pressed={tab === "wrongbook"} onClick={() => setTab("wrongbook")}>错题本（{book.value.records.length}）</Button></div>
    {[{ snapshot: saved, store: sessionStore }, { snapshot: book, store: wrongbookStore }].map(({ snapshot, store }, i) => snapshot.error ? <Card key={i} role="alert"><CardContent className="flex flex-wrap items-center justify-between gap-2 pt-6"><p className="text-sm">{snapshot.error}</p><Button variant="outline" size="sm" onClick={() => void store.retry()}><RefreshCw />{snapshot.writable ? "重试保存" : "重试读取"}</Button></CardContent></Card> : null)}
    {message ? <p role="alert" className="text-sm text-destructive">{message}</p> : null}
    {!saved.ready || !book.ready ? <p role="status">正在读取本设备数据…</p> : <>
      <p className="text-xs text-muted-foreground" role="status">{saved.dirty || book.dirty ? "存在尚未保存的数据，请勿关闭当前页面。" : "本设备数据已保存"}</p>
      {!canReplace ? <p role="status" className="text-sm">最近结果尚未完整保存到错题本，请先重试读取或保存；完成后即可开始新自测。</p> : null}
      {tab === "test" ? <>
        {!session || showSettings ? <Card><CardHeader><CardTitle>组卷设置</CardTitle></CardHeader><CardContent className="space-y-5">
          <div className="space-y-2"><p className="text-sm font-medium">题量</p><div className="flex flex-wrap gap-2">{[5, 10, 20, 30].map(value => <Button key={value} variant={countText === String(value) ? "default" : "outline"} size="sm" aria-pressed={countText === String(value)} onClick={() => setCountText(String(value))}>{value} 题</Button>)}</div><label className="block max-w-xs space-y-1 text-sm">自定义题量<Input aria-label="自定义题量" inputMode="numeric" value={countText} onChange={event => setCountText(event.target.value)} /></label></div>
          <div className="space-y-2" role="group" aria-label="题型"><p className="text-sm font-medium">题型（可多选）</p><div className="flex flex-wrap gap-2">{TYPES.map(type => <Button key={type} variant={types.includes(type) ? "default" : "outline"} aria-pressed={types.includes(type)} onClick={() => setTypes(toggle(types, type))}>{QUESTION_TYPE_LABELS[type]}</Button>)}</div></div>
          <div className="space-y-2" role="group" aria-label="难度"><p className="text-sm font-medium">难度（可多选；全部为不限）</p><div className="flex flex-wrap gap-2">{LEVELS.map(level => <Button key={level} variant={levels.includes(level) ? "default" : "outline"} aria-pressed={levels.includes(level)} onClick={() => setLevels(toggle(levels, level))}>{DIFFICULTY_LABELS[level]}</Button>)}</div></div>
          <p className="text-sm" role="status">符合条件的可用题：{available.length} 题。已排除未复核、无答案、结构缺损或题干预填答案的题。</p>
          {settingError ? <p role="alert" className="text-sm text-destructive">{settingError}</p> : null}
          <div className="flex flex-wrap gap-2">{count && count > available.length && available.length ? <Button variant="outline" onClick={() => setCountText(String(available.length))}>改为 {available.length} 题</Button> : null}<Button disabled={!!settingError || !saved.writable} onClick={() => { if (count) replace(createSession(sampleQuestions(available, count))); }}>开始自测</Button>{session ? <Button variant="ghost" onClick={() => setShowSettings(false)}>返回最近自测</Button> : null}</div>
        </CardContent></Card> : session.status === "answering" && question ? <>
          <Card><CardHeader><CardTitle className="text-lg">第 {session.cursor + 1} / {session.questions.length} 题</CardTitle><p className="text-sm">已答 {summary!.answered} / {summary!.total} · 完成率 {percent(summary!.completion)}</p></CardHeader><CardContent className="space-y-4">
            {session.source === "wrongbook-snapshot" ? <p className="text-sm text-muted-foreground">本次重练使用错题保存时的题目版本，原记录答对后仍保留。</p> : null}
            <p className="text-xs text-muted-foreground">{question.id} · {QUESTION_TYPE_LABELS[question.type]} · {DIFFICULTY_LABELS[question.difficulty]}</p><Markdown text={displayPrompt(question)} />
            {question.type === "fill" ? <label className="block space-y-2 text-sm">我的答案（多空按顺序用分号分隔）<Input aria-label="我的答案" value={session.answers[question.id] ?? ""} onChange={e => { const value = e.target.value; void sessionStore.update(s => s ? answerSession(s, question.id, value) : s); }} disabled={!saved.writable} /></label> : <div className="space-y-2" role="group" aria-label="答案选项">{(question.type === "judge" ? [{ id: "T", text: "正确" }, { id: "F", text: "错误" }] : question.options).map(option => <Button key={option.id} variant={session.answers[question.id] === option.id ? "default" : "outline"} className="h-auto w-full justify-start whitespace-normal text-left" aria-pressed={session.answers[question.id] === option.id} onClick={() => void sessionStore.update(s => s ? answerSession(s, question.id, option.id) : s)} disabled={!saved.writable}><span className="shrink-0">{option.id}．</span><Markdown text={option.text} className="md-inline min-w-0" /></Button>)}</div>}
            <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={session.cursor === 0 || !saved.writable} onClick={() => void sessionStore.update(s => s ? { ...s, cursor: s.cursor - 1 } : s)}>上一题</Button><Button variant="outline" disabled={session.cursor === session.questions.length - 1 || !saved.writable} onClick={() => void sessionStore.update(s => s ? { ...s, cursor: s.cursor + 1 } : s)}>下一题</Button><Button disabled={!saved.writable} onClick={() => unanswered.length ? setConfirmation({ kind: "submit" }) : submit()}>交卷</Button><Button variant="ghost" onClick={() => setShowSettings(true)}>重新设置</Button></div>
          </CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">题目进度</CardTitle></CardHeader><CardContent className="space-y-3"><div className="flex flex-wrap gap-2">{session.questions.map((q, index) => <Button key={q.id} size="sm" variant={index === session.cursor ? "default" : "outline"} aria-label={`第 ${index + 1} 题，${session.answers[q.id]?.trim() ? "已答" : "未答"}`} aria-pressed={index === session.cursor} onClick={() => void sessionStore.update(s => s ? { ...s, cursor: index } : s)} disabled={!saved.writable}>{index + 1}{session.answers[q.id]?.trim() ? <Check className="h-3 w-3" /> : null}</Button>)}</div><Button variant="outline" size="sm" disabled={!unanswered.length || !saved.writable} onClick={() => void sessionStore.update(s => s ? { ...s, cursor: s.questions.findIndex(q => !(s.answers[q.id] ?? "").trim()) } : s)}>定位第一道未答题（{unanswered.length}）</Button></CardContent></Card>
        </> : <>
          <Card><CardHeader><CardTitle>自测结果</CardTitle></CardHeader><CardContent className="space-y-3"><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{[["总题数", summary!.total], ["答对", summary!.correct], ["答错", summary!.wrong], ["待核对", summary!.pending], ["未答", summary!.unanswered], ["完成率", percent(summary!.completion)]].map(([label, value]) => <p key={label} className="text-sm">{label}：<strong>{value}</strong></p>)}</div><p>正确率：{summary!.accuracy === null ? "暂无可判定结果" : percent(summary!.accuracy)}<span className="ml-2 text-xs text-muted-foreground">按答对 /（答对 + 答错）计算</span></p><p className="text-sm text-muted-foreground">只有确定答错的题进入错题本；待核对和未答题单独保留。答对的重练题不会自动移出。</p><Button onClick={() => setShowSettings(true)}>重新组卷</Button></CardContent></Card>
          {renderExport()}
          {session.questions.map((q, index) => { const result = session.results[index]; return <Card key={q.id}><CardHeader><CardTitle className="text-base">{index + 1}. {q.id} · {STATUS_LABELS[result.status]}</CardTitle></CardHeader><CardContent className="space-y-3"><Markdown text={displayPrompt(q)} />{q.options.map(o => <Markdown key={o.id} text={`${o.id}．${o.text}`} />)}<div><p className="text-sm font-medium">我的答案</p><Markdown text={answerLabel(q, result.answer)} /></div><div><p className="text-sm font-medium">标准答案</p><Markdown text={answerLabel(q)} /></div><div><p className="text-sm font-medium">解析</p><Markdown text={q.analysis?.trim() || "原题暂无解析"} /></div></CardContent></Card>; })}
        </>}
      </> : <>
        <Card><CardHeader><CardTitle>独立错题本</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm text-muted-foreground">保存最近错误作答及其题目版本，按题目 ID 合并，累计答错次数。数据与原有笔记独立保存。</p><div className="grid gap-3 sm:grid-cols-2"><Select value={bookType} onValueChange={setBookType}><SelectTrigger aria-label="错题题型"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部题型</SelectItem>{TYPES.map(type => <SelectItem key={type} value={type}>{QUESTION_TYPE_LABELS[type]}</SelectItem>)}</SelectContent></Select><Select value={bookLevel} onValueChange={setBookLevel}><SelectTrigger aria-label="错题难度"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部难度</SelectItem>{LEVELS.map(level => <SelectItem key={level} value={level}>{DIFFICULTY_LABELS[level]}</SelectItem>)}</SelectContent></Select></div><p className="text-sm">当前筛选 {filteredRecords.length} 题 · 已勾选 {selected.filter(id => book.value.records.some(r => r.questionId === id)).length} 题</p><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => setSelected([...new Set([...selected, ...filteredRecords.map(r => r.questionId)])])} disabled={!filteredRecords.length}>勾选当前筛选</Button><Button variant="outline" size="sm" onClick={() => setSelected([])} disabled={!selected.length}>清空勾选</Button><Button disabled={!selected.some(id => book.value.records.some(r => r.questionId === id)) || !saved.writable} onClick={() => replace(createSession(book.value.records.filter(r => selected.includes(r.questionId)).map(r => r.question), "wrongbook-snapshot"))}>重练勾选错题（保存版本）</Button></div></CardContent></Card>
        {renderExport()}
        {!filteredRecords.length ? <p role="status">当前筛选没有错题。确定答错的题交卷后会自动收录。</p> : filteredRecords.map(record => <Card key={record.questionId}><CardHeader><CardTitle className="text-base">{record.questionId} · {QUESTION_TYPE_LABELS[record.question.type]} · {DIFFICULTY_LABELS[record.question.difficulty]}</CardTitle><p className="text-xs text-muted-foreground">累计答错 {record.wrongCount} 次 · 最近 {new Date(record.lastWrongAt).toLocaleString("zh-CN")} · 保存的作答版本</p></CardHeader><CardContent className="space-y-3"><Markdown text={displayPrompt(record.question)} />{record.question.options.map(o => <Markdown key={o.id} text={`${o.id}．${o.text}`} />)}<Markdown text={`**最近错误答案：** ${answerLabel(record.question, record.lastWrongAnswer)}\n\n**标准答案：** ${answerLabel(record.question, record.standardAnswer)}\n\n**解析：** ${record.analysis?.trim() || "原题暂无解析"}`} /><div className="flex flex-wrap gap-2"><Button variant={selected.includes(record.questionId) ? "default" : "outline"} aria-pressed={selected.includes(record.questionId)} onClick={() => setSelected(toggle(selected, record.questionId))}>{selected.includes(record.questionId) ? "取消勾选" : "勾选"}</Button><Button variant="outline" disabled={!saved.writable} onClick={() => replace(createSession([record.question], "wrongbook-snapshot"))}>重练此题（保存版本）</Button><Button variant="ghost" disabled={!book.writable} onClick={() => { void wrongbookStore.update(state => ({ ...state, records: state.records.filter(r => r.questionId !== record.questionId) })); setSelected(ids => ids.filter(id => id !== record.questionId)); }}><Trash2 />移出错题本</Button></div></CardContent></Card>)}
      </>}
    </>}
    <Dialog open={!!confirmation} onOpenChange={open => { if (!open) setConfirmation(null); }}><DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-lg"><DialogHeader><DialogTitle>{confirmation?.kind === "submit" ? "还有未答题，确认交卷？" : "开始一份新的自测？"}</DialogTitle><DialogDescription>{confirmation?.kind === "submit" ? `还有 ${unanswered.length} 题未作答。交卷后将单独标为未作答，不记入错题本。` : "当前未完成的自测将由新试卷替换。已保存的错题记录仍可在错题本查看。"}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setConfirmation(null)}>{confirmation?.kind === "submit" ? "继续作答" : "取消"}</Button><Button onClick={() => { if (confirmation?.kind === "submit") submit(); else if (confirmation?.next) { const next = confirmation.next; void sessionStore.update(() => next); setShowSettings(false); setTab("test"); setConfirmation(null); } }}>{confirmation?.kind === "submit" ? "确认交卷" : "开始新自测"}</Button></DialogFooter></DialogContent></Dialog>
  </main>;
}
