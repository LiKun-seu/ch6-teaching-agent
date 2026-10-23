import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * 生成 PDF 时把中文字体裁一份子集嵌进文件里。
 *
 * 只写标准字体名（STSong-Light 这类）而不嵌字体，浏览器自带的 PDF 阅读器
 * 找不到字体就会整篇画成乱码，所以这里自己从系统字体里裁子集。
 */

export type SubsetFont = {
  name: string;
  unitsPerEm: number;
  ascent: number;
  descent: number;
  capHeight: number;
  bbox: [number, number, number, number];
  /** 裁出来的字体文件本体（已经是完整 sfnt） */
  data: Buffer;
  /** 字符 → 子集里的字形号 */
  gidFor: Map<number, number>;
  /** 子集字形号 → 字宽（字体单位） */
  widths: Map<number, number>;
  /** 子集字形号 → 字符，用来生成 ToUnicode */
  unicodeFor: Map<number, number>;
};

export type PdfFont = {
  name: string;
  unitsPerEm: number;
  ascent: number;
  descent: number;
  capHeight: number;
  bbox: [number, number, number, number];
  /** 字符 → 字形号，字体里没有返回 0 */
  glyphFor(codePoint: number): number;
  /** 字形号 → 字宽，换算成 1000 单位/em */
  advanceEm(gid: number): number;
  /** 按用到的文字裁出可嵌入的子集 */
  subset(text: string): SubsetFont;
};

const u16 = (buffer: Buffer, offset: number) => buffer.readUInt16BE(offset);
const i16 = (buffer: Buffer, offset: number) => buffer.readInt16BE(offset);
const u32 = (buffer: Buffer, offset: number) => buffer.readUInt32BE(offset);

type Table = { tag: string; offset: number; length: number };

/** 单个 .ttf 或 .ttc（取里面第一份字体）的表目录 */
function readTables(data: Buffer): Map<string, Table> {
  let base = 0;
  if (data.length > 16 && u32(data, 0) === 0x74746366) base = u32(data, 12); // 'ttcf'
  const count = u16(data, base + 4);
  const tables = new Map<string, Table>();
  for (let index = 0; index < count; index += 1) {
    const record = base + 12 + index * 16;
    const tag = data.toString("latin1", record, record + 4);
    tables.set(tag, { tag, offset: u32(data, record + 8), length: u32(data, record + 12) });
  }
  return tables;
}

/** name 表里的 PostScript 名（nameID 6），拿不到就返回 null */
function readPostScriptName(data: Buffer, tables: Map<string, Table>): string | null {
  const table = tables.get("name");
  if (!table) return null;
  const count = u16(data, table.offset + 2);
  const stringBase = table.offset + u16(data, table.offset + 4);
  for (let index = 0; index < count; index += 1) {
    const record = table.offset + 6 + index * 12;
    if (u16(data, record + 6) !== 6) continue;
    const platform = u16(data, record);
    const length = u16(data, record + 8);
    const offset = stringBase + u16(data, record + 10);
    if (offset + length > data.length) continue;
    const raw = data.subarray(offset, offset + length);
    const value = platform === 3 || platform === 0 ? raw.swap16().toString("utf16le") : raw.toString("latin1");
    const clean = value.replace(/[^A-Za-z0-9-]/g, "");
    if (clean) return clean;
  }
  return null;
}

/** cmap 里挑一张最完整的子表，返回「字符 → 字形号」查表函数 */
function readCmap(data: Buffer, table: Table): (codePoint: number) => number {
  const count = u16(data, table.offset + 2);
  let best: { score: number; offset: number; format: number } | null = null;
  for (let index = 0; index < count; index += 1) {
    const record = table.offset + 4 + index * 8;
    const platform = u16(data, record);
    const encoding = u16(data, record + 2);
    const offset = table.offset + u32(data, record + 4);
    if (offset + 4 > data.length) continue;
    const format = u16(data, offset);
    let score = 0;
    if (platform === 3 && encoding === 10 && format === 12) score = 6;
    else if (platform === 0 && format === 12) score = 5;
    else if (platform === 3 && encoding === 1 && format === 4) score = 4;
    else if (platform === 0 && format === 4) score = 3;
    else if (platform === 3 && encoding === 0 && format === 4) score = 2;
    if (score && (!best || score > best.score)) best = { score, offset, format };
  }
  if (!best) return () => 0;

  if (best.format === 12) {
    const offset = best.offset;
    const groups = u32(data, offset + 12);
    const groupBase = offset + 16;
    return (codePoint: number) => {
      let low = 0;
      let high = groups - 1;
      while (low <= high) {
        const middle = (low + high) >> 1;
        const record = groupBase + middle * 12;
        const start = u32(data, record);
        const end = u32(data, record + 4);
        if (codePoint < start) high = middle - 1;
        else if (codePoint > end) low = middle + 1;
        else return u32(data, record + 8) + (codePoint - start);
      }
      return 0;
    };
  }

  const offset = best.offset;
  const segments = u16(data, offset + 6) / 2;
  const endBase = offset + 14;
  const startBase = endBase + segments * 2 + 2;
  const deltaBase = startBase + segments * 2;
  const rangeBase = deltaBase + segments * 2;
  return (codePoint: number) => {
    if (codePoint > 0xffff) return 0;
    let low = 0;
    let high = segments - 1;
    let hit = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (u16(data, endBase + middle * 2) < codePoint) low = middle + 1;
      else {
        hit = middle;
        high = middle - 1;
      }
    }
    if (hit < 0) return 0;
    const start = u16(data, startBase + hit * 2);
    if (codePoint < start) return 0;
    const delta = i16(data, deltaBase + hit * 2);
    const rangeOffset = u16(data, rangeBase + hit * 2);
    if (rangeOffset === 0) return (codePoint + delta) & 0xffff;
    const glyphOffset = rangeBase + hit * 2 + rangeOffset + (codePoint - start) * 2;
    if (glyphOffset + 2 > data.length) return 0;
    const glyph = u16(data, glyphOffset);
    return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
  };
}

/** 复合字形引用了哪些字形（普通字形返回空） */
function componentGlyphs(glyph: Buffer): number[] {
  if (glyph.length < 10 || i16(glyph, 0) >= 0) return [];
  const found: number[] = [];
  let cursor = 10;
  for (;;) {
    if (cursor + 4 > glyph.length) break;
    const flags = u16(glyph, cursor);
    found.push(u16(glyph, cursor + 2));
    cursor += 4;
    cursor += flags & 0x0001 ? 4 : 2;
    if (flags & 0x0008) cursor += 2;
    else if (flags & 0x0040) cursor += 4;
    else if (flags & 0x0080) cursor += 8;
    if (!(flags & 0x0020)) break;
  }
  return found;
}

/** 把复合字形里的部件字形号换成子集里的新号 */
function remapComponents(glyph: Buffer, rank: Map<number, number>) {
  if (glyph.length < 10 || i16(glyph, 0) >= 0) return;
  let cursor = 10;
  for (;;) {
    if (cursor + 4 > glyph.length) return;
    const flags = u16(glyph, cursor);
    const component = u16(glyph, cursor + 2);
    glyph.writeUInt16BE(rank.get(component) ?? 0, cursor + 2);
    cursor += 4;
    cursor += flags & 0x0001 ? 4 : 2;
    if (flags & 0x0008) cursor += 2;
    else if (flags & 0x0040) cursor += 4;
    else if (flags & 0x0080) cursor += 8;
    if (!(flags & 0x0020)) return;
  }
}

function checksum(data: Buffer): number {
  let sum = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    sum = (sum + (data.readUInt32BE(offset) >>> 0)) >>> 0;
  }
  return sum >>> 0;
}

function pad4(data: Buffer): Buffer {
  const rest = data.length % 4;
  return rest === 0 ? data : Buffer.concat([data, Buffer.alloc(4 - rest)]);
}

function log2(value: number): number {
  return Math.floor(Math.log2(value));
}

/** 把几张表拼成一份完整的 sfnt 字体文件 */
function assembleSfnt(entries: Array<[string, Buffer]>): Buffer {
  const tables = [...entries].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const count = tables.length;
  const searchRange = 16 * 2 ** log2(count);
  const header = Buffer.alloc(12 + count * 16);
  header.writeUInt32BE(0x00010000, 0);
  header.writeUInt16BE(count, 4);
  header.writeUInt16BE(searchRange, 6);
  header.writeUInt16BE(log2(count), 8);
  header.writeUInt16BE(count * 16 - searchRange, 10);

  const chunks: Buffer[] = [header];
  let offset = header.length;
  let headOffset = -1;
  tables.forEach(([tag, data], index) => {
    const record = 12 + index * 16;
    header.write(tag, record, 4, "latin1");
    header.writeUInt32BE(checksum(pad4(data)), record + 4);
    header.writeUInt32BE(offset, record + 8);
    header.writeUInt32BE(data.length, record + 12);
    if (tag === "head") headOffset = offset;
    const padded = pad4(data);
    chunks.push(padded);
    offset += padded.length;
  });
  const font = Buffer.concat(chunks, offset);
  if (headOffset >= 0) {
    font.writeUInt32BE((0xb1b0afba - checksum(font)) >>> 0, headOffset + 8);
  }
  return font;
}

/** 只带一张 format 4 子表的 cmap，每个字符一段（够用且不容易写错） */
function buildCmap(pairs: Array<[number, number]>): Buffer {
  const segments = pairs.filter(([codePoint]) => codePoint <= 0xffff);
  const segCount = segments.length + 1;
  const table = Buffer.alloc(12);
  table.writeUInt16BE(0, 0);
  table.writeUInt16BE(1, 2);
  table.writeUInt16BE(3, 4);
  table.writeUInt16BE(1, 6);
  table.writeUInt32BE(12, 8);

  const length = 16 + segCount * 8;
  const sub = Buffer.alloc(length);
  sub.writeUInt16BE(4, 0);
  sub.writeUInt16BE(length, 2);
  sub.writeUInt16BE(0, 4);
  sub.writeUInt16BE(segCount * 2, 6);
  const searchRange = 2 * 2 ** log2(segCount);
  sub.writeUInt16BE(searchRange, 8);
  sub.writeUInt16BE(log2(segCount), 10);
  sub.writeUInt16BE(segCount * 2 - searchRange, 12);

  const endBase = 14;
  const startBase = endBase + segCount * 2 + 2;
  const deltaBase = startBase + segCount * 2;
  const rangeBase = deltaBase + segCount * 2;
  segments.forEach(([codePoint, gid], index) => {
    sub.writeUInt16BE(codePoint, endBase + index * 2);
    sub.writeUInt16BE(codePoint, startBase + index * 2);
    sub.writeUInt16BE((gid - codePoint) & 0xffff, deltaBase + index * 2);
    sub.writeUInt16BE(0, rangeBase + index * 2);
  });
  const last = segCount - 1;
  sub.writeUInt16BE(0xffff, endBase + last * 2);
  sub.writeUInt16BE(0xffff, startBase + last * 2);
  sub.writeUInt16BE(1, deltaBase + last * 2);
  sub.writeUInt16BE(0, rangeBase + last * 2);
  return Buffer.concat([table, sub]);
}

function createPdfFont(data: Buffer): PdfFont {
  const tables = readTables(data);
  for (const tag of ["head", "hhea", "maxp", "hmtx", "loca", "glyf", "cmap"]) {
    if (!tables.has(tag)) throw new Error(`字体缺少 ${tag} 表，不是可以嵌入的 TrueType 字体`);
  }
  const head = tables.get("head")!;
  const hhea = tables.get("hhea")!;
  const maxp = tables.get("maxp")!;
  const hmtx = tables.get("hmtx")!;
  const loca = tables.get("loca")!;
  const glyf = tables.get("glyf")!;
  const cmapTable = tables.get("cmap")!;

  const unitsPerEm = u16(data, head.offset + 18) || 1000;
  const indexToLocFormat = i16(data, head.offset + 50);
  const bbox: [number, number, number, number] = [
    i16(data, head.offset + 36),
    i16(data, head.offset + 38),
    i16(data, head.offset + 40),
    i16(data, head.offset + 42),
  ];
  const ascent = i16(data, hhea.offset + 4);
  const descent = i16(data, hhea.offset + 6);
  const metricCount = u16(data, hhea.offset + 34);
  const glyphCount = u16(data, maxp.offset + 4);
  const name = readPostScriptName(data, tables) ?? "EmbeddedCJK";
  const lookup = readCmap(data, cmapTable);

  const locations: number[] = [];
  for (let index = 0; index <= glyphCount; index += 1) {
    locations.push(indexToLocFormat === 0 ? u16(data, loca.offset + index * 2) * 2 : u32(data, loca.offset + index * 4));
  }
  const glyphBytes = (gid: number): Buffer | null => {
    if (gid < 0 || gid >= glyphCount) return null;
    const start = glyf.offset + locations[gid];
    const end = glyf.offset + locations[gid + 1];
    if (start < 0 || end > data.length || end < start) return null;
    return data.subarray(start, end);
  };
  const advanceOf = (gid: number): number => {
    if (gid < 0 || gid >= glyphCount) return 0;
    if (gid < metricCount) return u16(data, hmtx.offset + gid * 4);
    return metricCount > 0 ? u16(data, hmtx.offset + (metricCount - 1) * 4) : 0;
  };
  const sideBearingOf = (gid: number): number => {
    if (gid < 0 || gid >= glyphCount) return 0;
    if (gid < metricCount) return i16(data, hmtx.offset + gid * 4 + 2);
    return i16(data, hmtx.offset + metricCount * 4 + (gid - metricCount) * 2);
  };

  return {
    name,
    unitsPerEm,
    ascent,
    descent,
    capHeight: Math.round(ascent * 0.72),
    bbox,
    glyphFor: lookup,
    advanceEm: (gid: number) => Math.round((advanceOf(gid) * 1000) / unitsPerEm),
    subset(text: string): SubsetFont {
      const wanted = new Map<number, number>();
      for (const char of text) {
        const codePoint = char.codePointAt(0) ?? 0;
        const gid = lookup(codePoint);
        if (gid && !wanted.has(gid)) wanted.set(gid, codePoint);
      }
      // 复合字形要把它引用的部件一起带上
      const keep = new Set<number>([0, ...wanted.keys()]);
      const queue = [...keep];
      while (queue.length) {
        const glyph = glyphBytes(queue.pop()!);
        if (!glyph) continue;
        for (const component of componentGlyphs(glyph)) {
          if (!keep.has(component)) {
            keep.add(component);
            queue.push(component);
          }
        }
      }
      const sorted = [...keep].sort((a, b) => a - b);
      const rank = new Map<number, number>();
      sorted.forEach((gid, index) => rank.set(gid, index));

      const glyphData: Buffer[] = [];
      const offsets: number[] = [0];
      let offset = 0;
      for (const gid of sorted) {
        const raw = glyphBytes(gid);
        const glyph = raw && raw.length ? Buffer.from(raw) : Buffer.alloc(0);
        if (glyph.length) remapComponents(glyph, rank);
        const padded = pad4(glyph);
        glyphData.push(padded);
        offset += padded.length;
        offsets.push(offset);
      }
      const locaData = Buffer.alloc(offsets.length * 4);
      offsets.forEach((value, index) => locaData.writeUInt32BE(value, index * 4));

      const headData = Buffer.from(data.subarray(head.offset, head.offset + head.length));
      headData.writeUInt32BE(0, 8); // checkSumAdjustment 稍后统一算
      headData.writeInt16BE(1, 50); // 统一用长格式 loca
      const hheaData = Buffer.from(data.subarray(hhea.offset, hhea.offset + hhea.length));
      hheaData.writeUInt16BE(sorted.length, 34);
      const maxpData = Buffer.from(data.subarray(maxp.offset, maxp.offset + maxp.length));
      maxpData.writeUInt16BE(sorted.length, 4);

      const hmtxData = Buffer.alloc(sorted.length * 4);
      const widths = new Map<number, number>();
      const unicodeFor = new Map<number, number>();
      const gidFor = new Map<number, number>();
      sorted.forEach((gid, index) => {
        hmtxData.writeUInt16BE(advanceOf(gid), index * 4);
        hmtxData.writeInt16BE(sideBearingOf(gid), index * 4 + 2);
        widths.set(index, advanceOf(gid));
      });
      for (const [gid, codePoint] of wanted) {
        const index = rank.get(gid);
        if (index === undefined) continue;
        gidFor.set(codePoint, index);
        if (!unicodeFor.has(index)) unicodeFor.set(index, codePoint);
      }

      const cmapData = buildCmap([...unicodeFor].map(([index, codePoint]) => [codePoint, index] as [number, number]).sort((a, b) => a[0] - b[0]));
      const fontData = assembleSfnt([
        ["cmap", cmapData],
        ["glyf", Buffer.concat(glyphData)],
        ["head", headData],
        ["hhea", hheaData],
        ["hmtx", hmtxData],
        ["loca", locaData],
        ["maxp", maxpData],
      ]);
      return { name, unitsPerEm, ascent, descent, capHeight: Math.round(ascent * 0.72), bbox, data: fontData, gidFor, widths, unicodeFor };
    },
  };
}

/** 讲解版 PDF 用衬线体（宋体一类），标题正文都更接近教材 */
const FONT_CANDIDATES = [
  process.env.MATERIAL_PDF_FONT ?? "",
  "C:\\Windows\\Fonts\\simsun.ttc",
  "/System/Library/Fonts/Supplemental/Songti.ttc",
  "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
  "/usr/share/fonts/truetype/arphic/uming.ttc",
  "C:\\Windows\\Fonts\\msyh.ttc",
  "C:\\Windows\\Fonts\\Deng.ttf",
  "C:\\Windows\\Fonts\\simhei.ttf",
  "C:\\Windows\\Fonts\\msjh.ttc",
  "/System/Library/Fonts/PingFang.ttc",
  "/System/Library/Fonts/Hiragino Sans GB.ttc",
  "/System/Library/Fonts/STHeiti Light.ttc",
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
];

const FONT_DIRECTORIES: Array<{ dir: string; pattern: RegExp }> = [
  { dir: "C:\\Windows\\Fonts", pattern: /^(simsun|msyh|deng|simhei|msjh)/i },
  { dir: "/System/Library/Fonts", pattern: /(songti|pingfang|hiragino|heiti)/i },
  { dir: "/usr/share/fonts/truetype/wqy", pattern: /\.tt[cf]$/i },
];

async function fontFiles(): Promise<string[]> {
  const found: string[] = [];
  for (const candidate of FONT_CANDIDATES) {
    if (candidate) found.push(candidate);
  }
  for (const { dir, pattern } of FONT_DIRECTORIES) {
    try {
      const names = await readdir(dir);
      for (const entry of names.filter((value) => pattern.test(value)).sort()) {
        found.push(path.join(dir, entry));
      }
    } catch {
      // 这个平台没有这个目录，跳过
    }
  }
  return [...new Set(found)];
}

let cachedFont: Promise<PdfFont> | null = null;

/** 找一份系统里的中文字体，读一次缓存住 */
export function loadPdfFont(): Promise<PdfFont> {
  if (!cachedFont) {
    cachedFont = (async () => {
      const tried: string[] = [];
      for (const file of await fontFiles()) {
        try {
          return createPdfFont(await readFile(file));
        } catch (err) {
          tried.push(`${file}（${err instanceof Error ? err.message : "读取失败"}）`);
        }
      }
      throw new Error(`没找到可嵌入的中文字体，PDF 里的中文会变成乱码。可以用 MATERIAL_PDF_FONT 指定字体文件。试过：${tried.join("；")}`);
    })().catch((err) => {
      cachedFont = null;
      throw err;
    });
  }
  return cachedFont;
}
