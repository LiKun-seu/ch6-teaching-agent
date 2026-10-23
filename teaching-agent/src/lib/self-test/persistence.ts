export type StorageAdapter<T> = { read(): Promise<T>; write(value: T): Promise<void> };
export type PersistentSnapshot<T> = { value: T; ready: boolean; writable: boolean; dirty: boolean; error: string | null };

/** 独立 key、串行写入；读取失败禁止覆盖旧数据，写入失败保留内存并可重试。 */
export function createPersistentStore<T>(storage: StorageAdapter<T>, initial: T, label: string) {
  let snapshot: PersistentSnapshot<T> = { value: initial, ready: false, writable: false, dirty: false, error: null };
  let initialization: Promise<void> | null = null;
  let reading = false;
  let writing = Promise.resolve();
  let revision = 0;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<PersistentSnapshot<T>>) => { snapshot = { ...snapshot, ...patch }; listeners.forEach(listener => listener()); };
  const initialize = () => {
    if (initialization) return initialization;
    reading = true;
    return initialization = storage.read().then(value => publish({ value, ready: true, writable: true, error: null }))
      .catch(() => publish({ ready: true, writable: false, error: `读取${label}失败；原有数据未被覆盖，请重试读取。` }))
      .finally(() => { reading = false; });
  };
  const persist = (value: T, savedRevision: number) => {
    writing = writing.then(async () => {
      try {
        await storage.write(value);
        if (revision === savedRevision) publish({ dirty: false, error: null });
      } catch { publish({ dirty: true, error: `${label}尚未保存，当前内存数据已保留，请释放空间后重试保存。` }); }
    });
    return writing;
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    initialize,
    async update(transform: (value: T) => T) {
      await initialize();
      if (!snapshot.writable) return false;
      const value = transform(snapshot.value);
      if (value === snapshot.value) return true;
      revision++;
      publish({ value, dirty: true });
      await persist(value, revision);
      return true;
    },
    async retry() {
      if (!snapshot.writable) { if (!reading) initialization = null; await initialize(); }
      else await persist(snapshot.value, revision);
    },
    settled: () => writing,
  };
}
export function localStorageAdapter<T>(key: string, empty: T, decode: (value: unknown) => T): StorageAdapter<T> {
  return {
    async read() { const raw = localStorage.getItem(key); return raw === null ? empty : decode(JSON.parse(raw)); },
    async write(value) { localStorage.setItem(key, JSON.stringify(value)); },
  };
}
