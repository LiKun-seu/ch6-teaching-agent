import "server-only";
import { qrcodegen } from "./vendor/qrcodegen";

export function qrSvg(text: string) {
  const qr = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.MEDIUM);
  const border = 4, size = qr.size + border * 2;
  const cells: string[] = [];
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.getModule(x, y)) cells.push(`M${x + border},${y + border}h1v1h-1z`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><path d="${cells.join("")}" fill="black"/></svg>`;
}
