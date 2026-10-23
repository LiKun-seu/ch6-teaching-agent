import type { Note } from "./notes-store";
import { BASE_PATH, appPath } from "./app-path";

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
}

/** 只导出本地课件或图片数据，禁止把任意笔记字符串拼进 HTML 属性。 */
export function noteImageSource(image: string): string | null {
  const unprefixed = BASE_PATH && image.startsWith(BASE_PATH + "/") ? image.slice(BASE_PATH.length) : image;
  if (/^\/slides\/slide-\d{3}\.png$/.test(unprefixed)) return appPath(unprefixed);
  if (/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/.test(image)) return image;
  return null;
}

export function noteImagesHtml(notes: Note[]): string {
  return notes.map(note => ({ note, image: note.image ? noteImageSource(note.image) : null }))
    .filter(item => item.image)
    .map(({ note, image }) => `<figure><img src="${escapeHtml(image!)}" alt=""><figcaption>${escapeHtml(note.title)}</figcaption></figure>`).join("");
}

export function rawNotesMarkdown(notes: Note[]) {
  return notes.filter(note => note.text.trim()).map(note => `## ${note.title || "笔记"}\n\n${note.text}`).join("\n\n");
}
