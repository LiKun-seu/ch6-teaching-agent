import { inflateSync } from "node:zlib";

export type RasterImage = { width: number; height: number; rgb: Buffer };
export type DecodedPng = RasterImage & { colorType: number; interlace: number; bitDepth: number };

/** 按块平均缩小。页眉里的校徽用不到原始分辨率，缩完再嵌进 PDF 才不至于几 MB。 */
export function downscale(image: RasterImage, maxSize: number): RasterImage {
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  if (scale >= 1) return image;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const top = Math.floor((y * image.height) / height);
    const bottom = Math.max(top + 1, Math.floor(((y + 1) * image.height) / height));
    for (let x = 0; x < width; x += 1) {
      const left = Math.floor((x * image.width) / width);
      const right = Math.max(left + 1, Math.floor(((x + 1) * image.width) / width));
      let red = 0;
      let green = 0;
      let blue = 0;
      let count = 0;
      for (let sy = top; sy < bottom; sy += 1) {
        for (let sx = left; sx < right; sx += 1) {
          const source = (sy * image.width + sx) * 3;
          red += image.rgb[source];
          green += image.rgb[source + 1];
          blue += image.rgb[source + 2];
          count += 1;
        }
      }
      const target = (y * width + x) * 3;
      rgb[target] = Math.round(red / count);
      rgb[target + 1] = Math.round(green / count);
      rgb[target + 2] = Math.round(blue / count);
    }
  }
  return { width, height, rgb };
}

/** 反 PNG 滤波：把一行原始字节还原成像素 */
function unfilter(line: Buffer, previous: Buffer, filter: number, channels: number) {
  const length = line.length;
  switch (filter) {
    case 0:
      break;
    case 1:
      for (let i = channels; i < length; i += 1) line[i] = (line[i] + line[i - channels]) & 0xff;
      break;
    case 2:
      for (let i = 0; i < length; i += 1) line[i] = (line[i] + previous[i]) & 0xff;
      break;
    case 3:
      for (let i = 0; i < length; i += 1) {
        const left = i >= channels ? line[i - channels] : 0;
        line[i] = (line[i] + ((left + previous[i]) >> 1)) & 0xff;
      }
      break;
    case 4:
      for (let i = 0; i < length; i += 1) {
        const a = i >= channels ? line[i - channels] : 0;
        const b = previous[i];
        const c = i >= channels ? previous[i - channels] : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        line[i] = (line[i] + predictor) & 0xff;
      }
      break;
    default:
      throw new Error("PNG 滤波类型不支持");
  }
}

/**
 * 解一张 8 位、非隔行的 RGB/RGBA PNG，透明部分压到白底，输出可以直接塞进 PDF 的 RGB 数据。
 * 只用来处理校徽这类小图；课件页图走 material-pdf 里那条更严格的通道。
 */
export function decodePng(png: Buffer): DecodedPng {
  if (png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("不是 PNG 文件");
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Buffer | null = null;
  let transparency: Buffer | null = null;
  const chunks: Buffer[] = [];
  for (let offset = 8; offset + 12 <= png.length; ) {
    const length = png.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > png.length) throw new Error("PNG 数据不完整");
    const type = png.toString("ascii", offset + 4, offset + 8);
    if (type === "IHDR") {
      const header = png.subarray(offset + 8, offset + 8 + length);
      width = header.readUInt32BE(0);
      height = header.readUInt32BE(4);
      bitDepth = header[8];
      colorType = header[9];
      interlace = header[12];
    } else if (type === "IDAT") {
      chunks.push(png.subarray(offset + 8, offset + 8 + length));
    } else if (type === "PLTE") {
      palette = Buffer.from(png.subarray(offset + 8, offset + 8 + length));
    } else if (type === "tRNS") {
      transparency = Buffer.from(png.subarray(offset + 8, offset + 8 + length));
    } else if (type === "IEND") {
      break;
    }
    offset = end;
  }
  if (!width || !height) throw new Error("PNG 缺少尺寸信息");
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 3 && colorType !== 6)) {
    throw new Error("只支持 8 位、非隔行的 RGB/RGBA/调色板 PNG");
  }
  if (colorType === 3 && !palette) throw new Error("调色板 PNG 缺少 PLTE");
  const table = palette;

  const channels = colorType === 6 ? 4 : colorType === 3 ? 1 : 3;
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const rgb = Buffer.alloc(width * height * 3);
  let previous = Buffer.alloc(stride);
  for (let row = 0; row < height; row += 1) {
    const start = row * (stride + 1);
    const filter = raw[start];
    const line = Buffer.from(raw.subarray(start + 1, start + 1 + stride));
    unfilter(line, previous, filter, channels);
    for (let column = 0; column < width; column += 1) {
      const source = column * channels;
      const target = (row * width + column) * 3;
      if (colorType === 3) {
        const index = line[source] * 3;
        const alpha = transparency && transparency.length > line[source] ? transparency[line[source]] / 255 : 1;
        rgb[target] = Math.round((table as Buffer)[index] * alpha + 255 * (1 - alpha));
        rgb[target + 1] = Math.round((table as Buffer)[index + 1] * alpha + 255 * (1 - alpha));
        rgb[target + 2] = Math.round((table as Buffer)[index + 2] * alpha + 255 * (1 - alpha));
      } else if (channels === 3) {
        rgb[target] = line[source];
        rgb[target + 1] = line[source + 1];
        rgb[target + 2] = line[source + 2];
      } else {
        const alpha = line[source + 3] / 255;
        rgb[target] = Math.round(line[source] * alpha + 255 * (1 - alpha));
        rgb[target + 1] = Math.round(line[source + 1] * alpha + 255 * (1 - alpha));
        rgb[target + 2] = Math.round(line[source + 2] * alpha + 255 * (1 - alpha));
      }
    }
    previous = line;
  }
  return { width, height, rgb, colorType, interlace, bitDepth };
}
