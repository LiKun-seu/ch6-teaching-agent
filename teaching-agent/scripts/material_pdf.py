#!/usr/bin/env python3
"""把课件图和题库做成可下载 PDF。

- original：public/slides 按 slides.json 页序拼成原版课件，不加要点
- questions：questions.json 与 k12-14-questions.json
- explain：某一 section 的课件图，加上 slide-notes.json 的 keys / points
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[1]
SLIDES_JSON = ROOT / "src" / "content" / "slides.json"
NOTES_JSON = ROOT / "src" / "content" / "slide-notes.json"
QUESTIONS_JSON = ROOT / "src" / "content" / "questions.json"
K12_JSON = ROOT / "src" / "content" / "k12-14-questions.json"
SLIDE_DIR = ROOT / "public" / "slides"

PAGE_W = 595.0
PAGE_H = 842.0
MARGIN = 40.0
CONTENT_W = PAGE_W - MARGIN * 2

FONT_CANDIDATES = [
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/Supplemental/Songti.ttc",
]

GREEK = {
    "alpha": "α",
    "beta": "β",
    "gamma": "γ",
    "Delta": "Δ",
    "delta": "δ",
    "varepsilon": "ε",
    "epsilon": "ε",
    "zeta": "ζ",
    "theta": "θ",
    "lambda": "λ",
    "mu": "μ",
    "nu": "ν",
    "xi": "ξ",
    "rho": "ρ",
    "sigma": "σ",
    "Sigma": "Σ",
    "tau": "τ",
    "phi": "φ",
    "varphi": "φ",
    "psi": "ψ",
}

SUB = str.maketrans("0123456789+-=()n", "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₙ")
SUP = str.maketrans("0123456789+-=()n", "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿ")

TYPE_LABEL = {"choice": "选择题", "judge": "判断题", "fill": "填空题"}


def font_file() -> str:
    for path in FONT_CANDIDATES:
        if Path(path).is_file():
            return path
    raise SystemExit("找不到可用的中文字体")


def take_braced(text: str, i: int) -> tuple[str, int]:
    if i >= len(text) or text[i] != "{":
        return "", i
    depth = 0
    for j in range(i, len(text)):
        if text[j] == "{":
            depth += 1
        elif text[j] == "}":
            depth -= 1
            if depth == 0:
                return text[i + 1 : j], j + 1
    return text[i + 1 :], len(text)


def replace_frac(text: str) -> str:
    out: list[str] = []
    i = 0
    while i < len(text):
        found = -1
        token = ""
        for name in ("\\dfrac", "\\frac"):
            pos = text.find(name, i)
            if pos >= 0 and (found < 0 or pos < found):
                found = pos
                token = name
        if found < 0:
            out.append(text[i:])
            break
        out.append(text[i:found])
        j = found + len(token)
        if j < len(text) and text[j] == "{":
            left, j = take_braced(text, j)
            if j < len(text) and text[j] == "{":
                right, j = take_braced(text, j)
                out.append(f"({left})/({right})")
            else:
                out.append(left)
        i = j
    return "".join(out)


def replace_sqrt(text: str) -> str:
    token = "\\sqrt"
    out: list[str] = []
    i = 0
    while True:
        pos = text.find(token, i)
        if pos < 0:
            out.append(text[i:])
            break
        out.append(text[i:pos])
        j = pos + len(token)
        if j < len(text) and text[j] == "{":
            body, j = take_braced(text, j)
            out.append(f"√({body})")
        i = j
    return "".join(out)


def replace_text(text: str) -> str:
    token = "\\text"
    out: list[str] = []
    i = 0
    while True:
        pos = text.find(token, i)
        if pos < 0:
            out.append(text[i:])
            break
        out.append(text[i:pos])
        j = pos + len(token)
        if j < len(text) and text[j] == "{":
            body, j = take_braced(text, j)
            out.append(body)
        i = j
    return "".join(out)


def apply_scripts(text: str, mark: str, table: dict[int, str]) -> str:
    out: list[str] = []
    i = 0
    while i < len(text):
        if text[i] == mark and i + 1 < len(text):
            if text[i + 1] == "{":
                body, i = take_braced(text, i + 1)
                out.append(body.translate(table))
                continue
            if text[i + 1].isalnum():
                out.append(text[i + 1].translate(table))
                i += 2
                continue
        out.append(text[i])
        i += 1
    return "".join(out)


def plain(value: str | None) -> str:
    text = value or ""
    text = text.replace("\\\\", "\\")
    for _ in range(4):
        nxt = replace_text(text)
        nxt = replace_frac(nxt)
        nxt = replace_sqrt(nxt)
        if nxt == text:
            break
        text = nxt
    text = (
        text.replace(r"\,", " ")
        .replace(r"\;", " ")
        .replace(r"\!", "")
        .replace(r"\quad", " ")
        .replace(r"\qquad", " ")
        .replace(r"\left", "")
        .replace(r"\right", "")
        .replace(r"\cdot", "·")
        .replace(r"\times", "×")
        .replace(r"\leq", "≤")
        .replace(r"\geq", "≥")
        .replace(r"\le", "≤")
        .replace(r"\ge", "≥")
        .replace(r"\approx", "≈")
        .replace(r"\sim", "~")
        .replace(r"\ll", "≪")
        .replace(r"\max", "max")
        .replace(r"\min", "min")
        .replace(r"\lim", "lim")
        .replace(r"\sin", "sin")
        .replace(r"\tan", "tan")
    )
    for name, glyph in GREEK.items():
        text = text.replace("\\" + name, glyph)
    text = apply_scripts(text, "_", SUB)
    text = apply_scripts(text, "^", SUP)
    text = re.sub(r"\\[a-zA-Z]+", "", text)
    text = text.replace("$", "").replace("{", "").replace("}", "")
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def slide_file(page: int) -> Path:
    path = SLIDE_DIR / f"slide-{page:03d}.png"
    if not path.is_file():
        raise SystemExit(f"缺少课件图 {path.name}")
    return path


class Writer:
    def __init__(self, font_path: str):
        self.doc = fitz.open()
        self.font_path = font_path
        self.font = fitz.Font(fontfile=font_path)
        self.page: fitz.Page | None = None
        self.y = MARGIN

    def new_page(self) -> None:
        self.page = self.doc.new_page(width=PAGE_W, height=PAGE_H)
        self.page.insert_font(fontname="cjk", fontfile=self.font_path)
        self.y = MARGIN

    def need(self, height: float) -> None:
        if self.page is None or self.y + height > PAGE_H - MARGIN:
            self.new_page()

    def wrap(self, text: str, size: float) -> list[str]:
        lines: list[str] = []
        for raw in text.split("\n"):
            if raw == "":
                lines.append("")
                continue
            buf = ""
            for ch in raw:
                trial = buf + ch
                if self.font.text_length(trial, size) <= CONTENT_W:
                    buf = trial
                    continue
                if buf and ch.isascii() and not ch.isspace() and buf[-1].isascii() and not buf[-1].isspace():
                    split = len(buf)
                    while split > 0 and buf[split - 1].isascii() and not buf[split - 1].isspace():
                        split -= 1
                    if 0 < split < len(buf):
                        lines.append(buf[:split].rstrip())
                        buf = buf[split:].lstrip() + ch
                        continue
                if buf:
                    lines.append(buf)
                buf = ch
            if buf:
                lines.append(buf)
        return lines

    def text(self, text: str, size: float = 11, gap: float = 4, color: tuple[float, float, float] = (0.1, 0.1, 0.09)) -> None:
        leading = size + gap
        for line in self.wrap(text, size):
            self.need(leading)
            assert self.page is not None
            if line:
                self.page.insert_text((MARGIN, self.y + size), line, fontname="cjk", fontsize=size, color=color)
            self.y += leading

    def gap(self, height: float = 8) -> None:
        self.y += height

    def image(self, path: Path, max_height: float) -> None:
        width = CONTENT_W
        height = width * 975 / 1300
        if height > max_height:
            height = max_height
            width = height * 1300 / 975
        self.need(height)
        assert self.page is not None
        x = MARGIN + (CONTENT_W - width) / 2
        rect = fitz.Rect(x, self.y, x + width, self.y + height)
        self.page.insert_image(rect, filename=str(path))
        self.y += height

    def save(self, dest: Path) -> None:
        dest.parent.mkdir(parents=True, exist_ok=True)
        self.doc.subset_fonts()
        tmp = dest.with_suffix(".tmp.pdf")
        self.doc.save(tmp, garbage=4, deflate=True)
        self.doc.close()
        tmp.replace(dest)


def build_original(dest: Path) -> None:
    slides = load_json(SLIDES_JSON)
    doc = fitz.open()
    width, height = 720.0, 540.0
    for slide in slides:
        page_no = int(slide["page"])
        page = doc.new_page(width=width, height=height)
        page.insert_image(page.rect, filename=str(slide_file(page_no)))
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".tmp.pdf")
    doc.save(tmp, garbage=4, deflate=True)
    doc.close()
    tmp.replace(dest)


def answer_text(question: dict) -> str:
    answer = question.get("answer")
    if answer is None or str(answer).strip() == "":
        return "暂无"
    raw = str(answer).strip()
    for option in question.get("options") or []:
        if option.get("id") == raw:
            label = plain(option.get("text"))
            return f"{raw}  {label}" if label else raw
    return plain(raw)


def write_question(writer: Writer, index: int, question: dict) -> None:
    kind = TYPE_LABEL.get(question.get("type") or "", "题目")
    qid = question.get("id") or str(index)
    writer.text(f"{index}. {qid}  {kind}", size=12, gap=3)
    writer.text(plain(question.get("prompt")), size=11, gap=3)
    for option in question.get("options") or []:
        oid = option.get("id") or ""
        writer.text(f"{oid}. {plain(option.get('text'))}", size=11, gap=2)
    writer.text(f"答案：{answer_text(question)}", size=11, gap=2)
    analysis = plain(question.get("analysis"))
    if analysis:
        writer.text(f"解析：{analysis}", size=10.5, gap=2, color=(0.25, 0.25, 0.23))
    writer.gap(10)


def build_questions(dest: Path) -> None:
    main = load_json(QUESTIONS_JSON)
    extra = load_json(K12_JSON)
    writer = Writer(font_file())
    writer.text("第六章 题库", size=18, gap=6)
    writer.text("课件章节题，以及受扭、变形、裂缝补充题。", size=10.5, gap=3, color=(0.35, 0.35, 0.32))
    writer.gap(8)
    writer.text("一、课件章节题", size=14, gap=4)
    writer.gap(4)
    for i, question in enumerate(main, start=1):
        write_question(writer, i, question)
    writer.gap(6)
    writer.text("二、受扭、变形与裂缝补充题", size=14, gap=4)
    writer.gap(4)
    for i, question in enumerate(extra, start=1):
        write_question(writer, i, question)
    writer.save(dest)


def build_explain(dest: Path, section: str) -> None:
    slides = [s for s in load_json(SLIDES_JSON) if s.get("section") == section]
    if not slides:
        raise SystemExit(f"没有这一节：{section}")
    notes = load_json(NOTES_JSON)
    writer = Writer(font_file())
    writer.text(f"讲解版  {section}", size=16, gap=4)
    writer.text("课件原图，下面是这一页整理过的重点和要点。", size=10.5, gap=3, color=(0.35, 0.35, 0.32))
    writer.gap(6)
    for slide in slides:
        # 标题和课件图放在同一页，要点太长再续到下一页
        if writer.page is not None and (PAGE_H - MARGIN - writer.y) < 460:
            writer.new_page()
        page_no = int(slide["page"])
        note = notes.get(str(page_no)) or {}
        title = plain(note.get("title")) or plain(slide.get("title")) or section
        writer.text(f"{section}  ·  第 {page_no} 页", size=12, gap=3)
        writer.text(title, size=11, gap=3, color=(0.2, 0.2, 0.18))
        writer.gap(4)
        writer.image(slide_file(page_no), max_height=390)
        writer.gap(8)
        keys = [plain(k) for k in (note.get("keys") or []) if plain(k)]
        points = [plain(p) for p in (note.get("points") or []) if plain(p)]
        if keys:
            writer.text("重点：" + "、".join(keys), size=11, gap=3)
            writer.gap(2)
        if points:
            writer.text("要点", size=11, gap=3)
            for point in points:
                writer.text("· " + point, size=10.5, gap=2)
        else:
            writer.text("这一页没有单独整理的要点。", size=10.5, gap=2, color=(0.35, 0.35, 0.32))
        writer.gap(14)
    writer.save(dest)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--kind", required=True, choices=("original", "questions", "explain"))
    parser.add_argument("--section", default="")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    dest = Path(args.out)
    if args.kind == "original":
        build_original(dest)
    elif args.kind == "questions":
        build_questions(dest)
    else:
        section = args.section.strip()
        if not section:
            raise SystemExit("讲解版需要 --section")
        build_explain(dest, section)


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        sys.exit(0)
