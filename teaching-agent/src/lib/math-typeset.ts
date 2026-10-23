import type { PdfFont } from "@/lib/ttf-font";

/**
 * 给手写 PDF 用的小型数学排版：够教材里的四则运算、分式、根式、上下标和希腊字母。
 * 输出一串相对基线的小图元（文字 / 横线），由 material-pdf 排进正文。
 */

export type MathItem =
  | { kind: "text"; text: string; dx: number; dy: number; size: number; italic: boolean }
  | { kind: "rule"; dx: number; dy: number; width: number; thickness: number };

export type MathBox = {
  width: number;
  /** 基线以上高度 */
  ascent: number;
  /** 基线以下深度，正数 */
  descent: number;
  items: MathItem[];
};

type Cls = "ord" | "bin" | "rel" | "punct" | "open" | "close" | "op";

type Elem =
  | { t: "sym"; text: string; cls: Cls; italic: boolean }
  | { t: "frac"; num: Elem[]; den: Elem[] }
  | { t: "sqrt"; body: Elem[] }
  | { t: "scripted"; base: Elem; sub?: Elem[]; sup?: Elem[] }
  | { t: "space"; em: number };

const SYMBOLS: Record<string, { text: string; cls: Cls }> = {
  alpha: { text: "α", cls: "ord" }, beta: { text: "β", cls: "ord" }, gamma: { text: "γ", cls: "ord" },
  delta: { text: "δ", cls: "ord" }, Delta: { text: "Δ", cls: "ord" }, varepsilon: { text: "ε", cls: "ord" },
  epsilon: { text: "ε", cls: "ord" }, zeta: { text: "ζ", cls: "ord" }, eta: { text: "η", cls: "ord" },
  theta: { text: "θ", cls: "ord" }, kappa: { text: "κ", cls: "ord" }, lambda: { text: "λ", cls: "ord" },
  mu: { text: "μ", cls: "ord" }, nu: { text: "ν", cls: "ord" }, xi: { text: "ξ", cls: "ord" },
  pi: { text: "π", cls: "ord" }, rho: { text: "ρ", cls: "ord" }, sigma: { text: "σ", cls: "ord" },
  Sigma: { text: "Σ", cls: "op" }, tau: { text: "τ", cls: "ord" }, phi: { text: "φ", cls: "ord" },
  varphi: { text: "φ", cls: "ord" }, psi: { text: "ψ", cls: "ord" }, omega: { text: "ω", cls: "ord" },
  leq: { text: "≤", cls: "rel" }, le: { text: "≤", cls: "rel" }, geq: { text: "≥", cls: "rel" },
  ge: { text: "≥", cls: "rel" }, neq: { text: "≠", cls: "rel" }, approx: { text: "≈", cls: "rel" },
  sim: { text: "~", cls: "rel" }, ll: { text: "≪", cls: "rel" }, gg: { text: "≫", cls: "rel" },
  equiv: { text: "≡", cls: "rel" }, propto: { text: "∝", cls: "rel" }, infty: { text: "∞", cls: "ord" },
  pm: { text: "±", cls: "bin" }, mp: { text: "∓", cls: "bin" }, times: { text: "×", cls: "bin" },
  cdot: { text: "·", cls: "bin" }, div: { text: "÷", cls: "bin" }, ast: { text: "*", cls: "bin" },
  to: { text: "→", cls: "rel" }, rightarrow: { text: "→", cls: "rel" }, sum: { text: "Σ", cls: "op" },
  max: { text: "max", cls: "op" }, min: { text: "min", cls: "op" }, lim: { text: "lim", cls: "op" },
  sin: { text: "sin", cls: "op" }, cos: { text: "cos", cls: "op" }, tan: { text: "tan", cls: "op" },
  lg: { text: "lg", cls: "op" }, ln: { text: "ln", cls: "op" }, log: { text: "log", cls: "op" },
  degree: { text: "°", cls: "ord" }, percent: { text: "%", cls: "ord" }, prime: { text: "′", cls: "ord" },
};

const SPACES: Record<string, number> = {
  ",": 0.17, ";": 0.28, " ": 0.25, "!": -0.17, quad: 1, qquad: 2,
};

function classOfChar(char: string): Cls {
  if ("+-*/".includes(char)) return "bin";
  if ("=<>".includes(char)) return "rel";
  if (",;".includes(char)) return "punct";
  if ("([{".includes(char)) return "open";
  if (")]}".includes(char)) return "close";
  return "ord";
}

function readGroup(src: string, index: number): [string, number] {
  if (src[index] !== "{") return ["", index];
  let depth = 0;
  for (let end = index; end < src.length; end += 1) {
    if (src[end] === "{") depth += 1;
    else if (src[end] === "}") {
      depth -= 1;
      if (depth === 0) return [src.slice(index + 1, end), end + 1];
    }
  }
  return [src.slice(index + 1), src.length];
}

/** 取 `_` / `^` 后面那一个参数：花括号组、一条命令，或一个字符 */
function readArg(src: string, index: number): [string, number] {
  if (src[index] === "{") return readGroup(src, index);
  if (src[index] === "\\") {
    const match = /^\\([a-zA-Z]+|.)/.exec(src.slice(index));
    if (match) return [match[0], index + match[0].length];
  }
  return src[index] ? [src[index], index + 1] : ["", index];
}

function parseElems(src: string): Elem[] {
  const out: Elem[] = [];
  let index = 0;
  while (index < src.length) {
    const char = src[index];
    if (char === " ") {
      index += 1;
      continue;
    }
    if (char === "{") {
      const [inner, next] = readGroup(src, index);
      out.push(...parseElems(inner));
      index = next;
      continue;
    }
    if (char === "}" || char === "&") {
      index += 1;
      continue;
    }
    if (char === "_" || char === "^") {
      const [arg, next] = readArg(src, index + 1);
      index = next;
      const last = out[out.length - 1];
      if (!last) continue;
      const body = parseElems(arg);
      if (last.t === "scripted") {
        if (char === "_") last.sub = body;
        else last.sup = body;
      } else {
        out[out.length - 1] = { t: "scripted", base: last, ...(char === "_" ? { sub: body } : { sup: body }) };
      }
      continue;
    }
    if (char === "\\") {
      const match = /^\\([a-zA-Z]+|.)/.exec(src.slice(index));
      if (!match) {
        index += 1;
        continue;
      }
      const name = match[1];
      index += match[0].length;
      if (name === "frac" || name === "dfrac" || name === "tfrac") {
        const [top, afterTop] = readArg(src, index);
        const [bottom, afterBottom] = readArg(src, afterTop);
        index = afterBottom;
        out.push({ t: "frac", num: parseElems(top), den: parseElems(bottom) });
        continue;
      }
      if (name === "sqrt") {
        const [body, next] = readArg(src, index);
        index = next;
        out.push({ t: "sqrt", body: parseElems(body) });
        continue;
      }
      if (name === "text" || name === "mathrm" || name === "operatorname" || name === "mbox") {
        const [body, next] = readGroup(src, index);
        if (next === index) {
          const [arg, after] = readArg(src, index);
          index = after;
          out.push({ t: "sym", text: arg, cls: "ord", italic: false });
          continue;
        }
        index = next;
        out.push({ t: "sym", text: body, cls: "ord", italic: false });
        continue;
      }
      if (name in SPACES) {
        out.push({ t: "space", em: SPACES[name] });
        continue;
      }
      if (name === "left" || name === "right" || name === "!" || name === "displaystyle") {
        if (name === "!") out.push({ t: "space", em: -0.17 });
        continue;
      }
      const symbol = SYMBOLS[name];
      if (symbol) {
        out.push({ t: "sym", text: symbol.text, cls: symbol.cls, italic: false });
        continue;
      }
      // 不认识的命令就丢掉，免得源码漏到纸上
      continue;
    }
    out.push({ t: "sym", text: char, cls: classOfChar(char), italic: /[a-zA-Z]/.test(char) });
    index += 1;
  }
  return out;
}

/** 两个元素之间留多大空（em），照 TeX 的粗规则来 */
function gapEm(prev: Cls, next: Cls): number {
  if (prev === "punct") return 0.17;
  if (next === "punct") return 0;
  if (prev === "open" || next === "close") return 0;
  if (prev === "bin" || next === "bin") return 0.2;
  if (prev === "rel" || next === "rel") return 0.26;
  if (prev === "op") return 0.16;
  return 0;
}

function glyphWidth(font: PdfFont, text: string, size: number) {
  let units = 0;
  for (const char of text) {
    const gid = font.glyphFor(char.codePointAt(0) ?? 0);
    units += gid ? font.advanceEm(gid) : 500;
  }
  return (units * size) / 1000;
}

function shift(box: MathBox, dx: number, dy: number, size?: number): MathBox {
  const scale = size === undefined ? 1 : size;
  return {
    width: box.width * scale,
    ascent: box.ascent * scale,
    descent: box.descent * scale,
    items: box.items.map((item) =>
      item.kind === "text"
        ? { ...item, dx: item.dx * scale + dx, dy: item.dy * scale + dy, size: item.size * scale }
        : { ...item, dx: item.dx * scale + dx, dy: item.dy * scale + dy, width: item.width * scale, thickness: item.thickness * scale },
    ),
  };
}

function symBox(font: PdfFont, text: string, size: number, italic: boolean): MathBox {
  return {
    width: glyphWidth(font, text, size),
    ascent: size * 0.74,
    descent: size * 0.22,
    items: [{ kind: "text", text, dx: 0, dy: 0, size, italic }],
  };
}

function layoutList(elems: Elem[], size: number, font: PdfFont): MathBox {
  const parts: { box: MathBox; cls: Cls }[] = [];
  for (const elem of elems) {
    const box = layoutElem(elem, size, font);
    if (box) parts.push({ box, cls: elem.t === "space" ? "ord" : elem.t === "frac" || elem.t === "sqrt" || elem.t === "scripted" || elem.t === "sym" ? elemCls(elem) : "ord" });
  }
  let cursor = 0;
  let ascent = 0;
  let descent = 0;
  const items: MathItem[] = [];
  parts.forEach((part, index) => {
    const prev = parts[index - 1];
    if (prev) cursor += gapEm(prev.cls, part.cls) * size;
    const moved = shift(part.box, cursor, 0);
    items.push(...moved.items);
    ascent = Math.max(ascent, moved.ascent);
    descent = Math.max(descent, moved.descent);
    cursor += part.box.width;
  });
  return { width: cursor, ascent: ascent || size * 0.74, descent: descent || size * 0.22, items };
}

function elemCls(elem: Elem): Cls {
  if (elem.t === "sym") return elem.cls;
  return "ord";
}

function layoutElem(elem: Elem, size: number, font: PdfFont): MathBox | null {
  if (elem.t === "space") {
    return { width: elem.em * size, ascent: 0, descent: 0, items: [] };
  }
  if (elem.t === "sym") {
    return symBox(font, elem.text, size, elem.italic);
  }
  if (elem.t === "frac") {
    const num = layoutList(elem.num, size * 0.94, font);
    const den = layoutList(elem.den, size * 0.94, font);
    const axis = size * 0.26;
    const gap = size * 0.14;
    const thickness = Math.max(0.5, size * 0.05);
    const width = Math.max(num.width, den.width) + size * 0.28;
    const numDx = (width - num.width) / 2;
    const denDx = (width - den.width) / 2;
    const numBaseline = axis + gap + num.descent;
    const denBaseline = axis - gap - den.ascent;
    const moved = shift(num, numDx, numBaseline);
    const movedDen = shift(den, denDx, denBaseline);
    return {
      width,
      ascent: numBaseline + num.ascent,
      descent: -(denBaseline - den.descent),
      items: [
        ...moved.items,
        { kind: "rule", dx: 0, dy: axis, width, thickness },
        ...movedDen.items,
      ],
    };
  }
  if (elem.t === "sqrt") {
    const body = layoutList(elem.body, size, font);
    const height = body.ascent + body.descent;
    const radicalSize = Math.min(size * 2.3, Math.max(size, (height + size * 0.2) / 0.7));
    const radical = symBox(font, "√", radicalSize, false);
    const radicalWidth = radicalSize * 0.5;
    const overline = { kind: "rule" as const, dx: radicalWidth, dy: height + size * 0.1, width: body.width + size * 0.12, thickness: Math.max(0.5, size * 0.05) };
    const base = height - radicalSize * 0.62;
    return {
      width: radicalWidth + body.width + size * 0.12,
      ascent: height + size * 0.14,
      descent: Math.max(0, -base),
      items: [
        { kind: "text", text: "√", dx: 0, dy: base, size: radicalSize, italic: false },
        overline,
        ...shift(body, radicalWidth, 0).items,
      ],
    };
  }
  if (elem.t === "scripted") {
    const base = layoutElem(elem.base, size, font);
    if (!base) return null;
    const scriptSize = size * 0.72;
    const sub = elem.sub ? layoutList(elem.sub, scriptSize, font) : null;
    const sup = elem.sup ? layoutList(elem.sup, scriptSize, font) : null;
    const items = [...base.items];
    let ascent = base.ascent;
    let descent = base.descent;
    let width = base.width;
    if (sup) {
      const dy = size * 0.42;
      const moved = shift(sup, base.width + size * 0.02, dy);
      items.push(...moved.items);
      ascent = Math.max(ascent, dy + sup.ascent);
      width += size * 0.02 + sup.width;
    }
    if (sub) {
      const dy = -size * 0.16;
      const dx = base.width + size * 0.02;
      const moved = shift(sub, dx, dy);
      items.push(...moved.items);
      descent = Math.max(descent, -(dy - sub.descent));
      width = Math.max(width, dx + sub.width);
    }
    return { width, ascent, descent, items };
  }
  return null;
}

/** 把一段 $...$ 里的内容排成一个小盒子 */
export function layoutMath(latex: string, size: number, font: PdfFont): MathBox {
  const box = layoutList(parseElems(latex), size, font);
  return { width: box.width, ascent: box.ascent, descent: box.descent, items: box.items };
}
