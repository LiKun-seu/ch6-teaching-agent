#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把调查员产出的结构化材料转成前端/服务端可直接消费的 JSON。

输入：.agent-runs/2026-10-13/task-001/content/{ch6-slides.md, question-bank.md, ch6-knowledge.md}
输出：src/content/{slides.json, questions.json, ch6-knowledge.md}
"""
import json
import os
import re
import shutil

ROOT = "/Users/cjr/Desktop/agent/teaching-agent"
SRC = "/Users/cjr/Desktop/agent/.agent-runs/2026-10-13/task-001/content"
OUT = os.path.join(ROOT, "src", "content")
os.makedirs(OUT, exist_ok=True)

# ---------------- 幻灯片 ----------------
slides_raw = open(os.path.join(SRC, "ch6-slides.md"), encoding="utf-8").read()
blocks = re.split(r"\n## 第\s*(\d+)\s*页\n", slides_raw)

slides = []
for i in range(1, len(blocks), 2):
    page = int(blocks[i])
    body = blocks[i + 1]
    section = ""
    title = ""
    bullets = []
    mode = None
    for line in body.splitlines():
        s = line.rstrip()
        if not s.strip():
            continue
        if s.startswith("- **所属知识节**"):
            section = s.split("：", 1)[-1].strip().strip("*").strip()
            mode = None
            continue
        if s.startswith("- **标题**"):
            title = s.split("：", 1)[-1].strip().strip("*").strip()
            mode = None
            continue
        if s.startswith("- **要点文本**") or s.startswith("- **OCR"):
            mode = "bullets"
            continue
        if s.startswith("- **"):
            mode = None
            continue
        if mode == "bullets":
            m = re.match(r"^\s*[-*]\s+(.*)$", s)
            if m:
                t = m.group(1).strip()
                if t and not t.startswith("*"):
                    bullets.append(t)
            elif bullets and s.startswith("   "):
                bullets[-1] += s.strip()
    if not title and bullets:
        title = bullets[0]
    slides.append({
        "page": page,
        "section": section or "未归类",
        "title": title or f"第 {page} 页",
        "bullets": bullets[:12],
        "image": f"/slides/slide-{page:03d}.png",
    })

slides.sort(key=lambda x: x["page"])

# ---------------- 题库 ----------------
qb_raw = open(os.path.join(SRC, "question-bank.md"), encoding="utf-8").read()
questions = []

opt_line_re = re.compile(r"^\s*[-*]?\s*([ABCD])[．.、]\s*(.*)$")
split_multi_re = re.compile(r"(?<=\S)\s+(?=[ABCD][．.、])")


def parse_options(lines):
    opts = {}
    order = []
    for line in lines:
        s = line.strip()
        if not s:
            continue
        m = opt_line_re.match(s)
        if not m:
            continue
        for part in split_multi_re.split(s):
            mm = opt_line_re.match(part.strip())
            if mm:
                key = mm.group(1)
                text = mm.group(2).strip()
                if key not in opts:
                    opts[key] = text
                    order.append(key)
    return [{"id": k, "text": opts[k]} for k in order]


# 按题型分块
sec_re = re.compile(r"^## ([一二三四])、(.+)$", re.M)
sections = list(sec_re.finditer(qb_raw))
for idx, m in enumerate(sections):
    kind_cn = m.group(2)
    start = m.end()
    end = sections[idx + 1].start() if idx + 1 < len(sections) else len(qb_raw)
    chunk = qb_raw[start:end]
    if "单项选择" in kind_cn:
        kind = "choice"
    elif "填空" in kind_cn:
        kind = "fill"
    elif "判断" in kind_cn:
        kind = "judge"
    else:
        continue
    for qm in re.finditer(r"^### ([A-Z]{2}-\d+)\s*$", chunk, re.M):
        qid = qm.group(1)
        qstart = qm.end()
        nxt = chunk.find("### ", qstart)
        body = chunk[qstart: nxt if nxt > 0 else len(chunk)]
        lines = [l.rstrip() for l in body.splitlines() if l.strip()]
        if not lines:
            continue
        stmt_lines = []
        opt_lines = []
        for l in lines:
            if opt_line_re.match(l.strip()) and any(l.strip().startswith(x) for x in ("A", "B", "C", "D", "- A", "- B", "- C", "- D")):
                opt_lines.append(l)
            elif opt_line_re.match(l.strip()):
                opt_lines.append(l)
            else:
                stmt_lines.append(l.strip())
        prompt = " ".join(stmt_lines).strip()
        prompt = re.sub(r"\s*（\s*）\s*$", "（  ）", prompt)
        item = {
            "id": qid,
            "type": kind,
            "prompt": prompt,
            "options": parse_options(opt_lines) if kind == "choice" else [],
            "answer": None,          # 待团队从教材推导（Phase 1.5）
            "analysis": None,
            "source": "第六章题库",
        }
        if kind == "judge":
            item["options"] = [{"id": "T", "text": "正确"}, {"id": "F", "text": "错误"}]
        questions.append(item)

with open(os.path.join(OUT, "slides.json"), "w", encoding="utf-8") as f:
    json.dump(slides, f, ensure_ascii=False, indent=1)
with open(os.path.join(OUT, "questions.json"), "w", encoding="utf-8") as f:
    json.dump(questions, f, ensure_ascii=False, indent=1)
shutil.copy(os.path.join(SRC, "ch6-knowledge.md"), os.path.join(OUT, "ch6-knowledge.md"))

counts = {}
for q in questions:
    counts[q["type"]] = counts.get(q["type"], 0) + 1
print(f"slides: {len(slides)} 页")
print(f"questions: {len(questions)} 题 {counts}")
print("样例：", json.dumps(questions[1], ensure_ascii=False)[:220])
