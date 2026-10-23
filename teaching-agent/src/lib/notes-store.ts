export type NoteKind = "text" | "page" | "element" | "question";
export type Note = { id: string; kind: NoteKind; title: string; text: string; image?: string; at: number };
export type NoteDraft = { kind?: NoteKind; title?: string; text: string; image?: string };
export type NoteStorage = { read(): Promise<Note[]>; write(notes: Note[]): Promise<void> };
type Snapshot = { notes: Note[]; error: string | null; ready: boolean };
const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

export function normalizeNotes(raw: unknown): Note[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): Note[] => {
    if (!item || typeof item !== "object") return [];
    const note = item as Partial<Note>;
    const text = typeof note.text === "string" ? note.text : "";
    const image = typeof note.image === "string" ? note.image : undefined;
    if (!text.trim() && !image) return [];
    return [{
      id: typeof note.id === "string" ? note.id : uid(),
      kind: ["text", "page", "element", "question"].includes(note.kind ?? "") ? note.kind! : "text",
      title: typeof note.title === "string" ? note.title : text.slice(0, 28) || "笔记",
      text, image, at: typeof note.at === "number" ? note.at : Date.now(),
    }];
  }).slice(0, 80);
}

/** 内存是当前数据源；写入串行，失败后下一次操作仍保留未落盘的数据。 */
export function createNotesStore(storage: NoteStorage) {
  let snapshot: Snapshot = { notes: [], error: null, ready: false };
  let initialization: Promise<void> | null = null;
  let writing = Promise.resolve();
  let loadFailed = false;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<Snapshot>) => { snapshot = { ...snapshot, ...patch }; listeners.forEach(listener => listener()); };
  const initialize = () => initialization ??= storage.read()
    .then(notes => { loadFailed = false; publish({ notes: normalizeNotes(notes), ready: true, error: null }); })
    .catch(() => { loadFailed = true; publish({ ready: true, error: "读取笔记失败，请稍后刷新重试；原有存储未被覆盖。" }); });
  const persist = (notes: Note[]) => {
    writing = writing.then(async () => {
      try { await storage.write(notes); publish({ error: null }); }
      catch { publish({ error: "笔记尚未保存，已保留在当前页面。请导出备份或释放存储空间后重试。" }); }
    });
    return writing;
  };
  const mutate = async (update: (notes: Note[]) => Note[]) => {
    await initialize();
    if (loadFailed) return;
    const notes = update(snapshot.notes);
    publish({ notes });
    await persist(notes);
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async initialize() {
      await initialize();
      loadFailed = snapshot.error?.startsWith("读取笔记失败") ?? false;
    },
    add(input: string | NoteDraft) {
      const draft = typeof input === "string" ? { text: input } : input;
      if (!draft.text.trim() && !draft.image) return Promise.resolve();
      const note: Note = { ...draft, id: uid(), kind: draft.kind ?? "text", title: draft.title?.trim() || draft.text.slice(0, 28) || "笔记", at: Date.now() };
      return mutate(notes => [note, ...notes].slice(0, 80));
    },
    update(id: string, patch: Partial<Pick<Note, "title" | "text">>) {
      return mutate(notes => notes.map(note => note.id === id ? { ...note, ...patch, title: patch.title?.trim() || note.title } : note));
    },
    remove(id: string) { return mutate(notes => notes.filter(note => note.id !== id)); },
    async retry() { if (loadFailed) initialization = null; await initialize(); if (!loadFailed) await persist(snapshot.notes); },
    settled: () => writing,
  };
}

const KEY = "ch6-notes-v2";
let database: Promise<IDBDatabase> | null = null;
function openDatabase(): Promise<IDBDatabase> {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("ch6-notes", 1);
    let expired = false;
    const timer = setTimeout(() => { expired = true; reject(new Error("笔记存储被其他页面占用")); }, 5000);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("state")) request.result.createObjectStore("state"); };
    request.onerror = () => { clearTimeout(timer); reject(request.error); };
    request.onsuccess = () => {
      clearTimeout(timer);
      const db = request.result;
      if (expired) { db.close(); return; }
      db.onversionchange = () => { db.close(); database = null; };
      resolve(db);
    };
  }).catch(error => { database = null; throw error; });
  return database;
}

async function readDatabase(): Promise<unknown> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("state", "readonly");
    const request = transaction.objectStore("state").get("notes");
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error("读取笔记失败"));
  });
}

async function writeDatabase(notes: Note[]) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("state", "readwrite");
    transaction.objectStore("state").put(notes, "notes");
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error("保存笔记失败"));
  });
}

export const browserNoteStorage: NoteStorage = {
  async read() {
    let databaseError: unknown;
    if (typeof indexedDB !== "undefined") {
      try { const value = await readDatabase(); if (value !== undefined) return normalizeNotes(value); }
      catch (error) { databaseError = error; }
    }
    const saved = localStorage.getItem(KEY) ?? localStorage.getItem("ch6-notes-v1");
    if (saved !== null) return normalizeNotes(JSON.parse(saved));
    if (databaseError) throw databaseError;
    return [];
  },
  async write(notes) {
    if (typeof indexedDB !== "undefined") {
      await writeDatabase(notes);
      // IndexedDB 提交成功后再清理旧副本，避免迁移时丢失笔记。
      try { localStorage.removeItem(KEY); localStorage.removeItem("ch6-notes-v1"); } catch { /* 旧副本不影响新存储 */ }
    } else localStorage.setItem(KEY, JSON.stringify(notes));
  },
};
