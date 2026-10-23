"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { appPath } from "@/lib/app-path";
import type { Snapshot } from "@/lib/classroom/types";

export class ClassroomApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export async function classroomFetch<T>(path: string, data?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(appPath(path), { method: data === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store",
    headers: data === undefined ? {} : { "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data),
    signal: signal ?? AbortSignal.timeout(12_000) });
  const result = await response.json();
  if (!response.ok) throw new ClassroomApiError(result.error || "课堂请求失败，请重试", response.status);
  return result as T;
}
export const classroomRequestId = () => {
  if (typeof globalThis.crypto?.randomUUID === "function") return crypto.randomUUID();
  // crypto.getRandomValues is also available on LAN HTTP pages lacking randomUUID.
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (Number(c) ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> Number(c) / 4).toString(16));
};

export function useClassroom<T extends Snapshot>(id: string | null, student: boolean, active: boolean) {
  const [state, setState] = useState<T | null>(null);
  const [connection, setConnection] = useState("连接中");
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  const currentId = useRef(id);
  currentId.current = id;
  const refreshRef = useRef<() => void>(() => {});
  const accept = useCallback((next: T) => {
    if (next.classroom.id !== currentId.current) return;
    setState(prior => {
      if (next.classroom.id !== currentId.current) return prior;
      return !prior || prior.classroom.id !== currentId.current || next.classroom.version >= prior.classroom.version ? next : prior;
    });
  }, []);
  useEffect(() => {
    setState(null); setError(""); setExpired(false);
  }, [id]);
  useEffect(() => {
    if (!id || !active) { setConnection("已暂停"); return; }
    const path = `/api/${student ? "classroom-participation" : "classrooms"}/${id}`;
    let disposed = false, source: EventSource | undefined, fetching = false, lastEvent = Date.now(), lastConnect = 0, ended = false, authFailed = false;
    const abort = new AbortController();
    const failure = (err: unknown) => {
      if (disposed) return;
      setError(err instanceof Error ? err.message : "连接断开，请重试"); setConnection("已断开，正在重试");
      if (err instanceof ClassroomApiError && [401, 403, 404].includes(err.status)) {
        authFailed = true; setExpired(true); source?.close();
      }
    };
    const consume = (next: T) => {
      if (disposed) return;
      accept(next); setError(""); ended = next.classroom.status === "ended";
      if (ended) { source?.close(); source = undefined; setConnection("课堂已结束"); }
    };
    const connect = () => {
      if (disposed || ended || authFailed || document.hidden || source) return;
      lastConnect = Date.now();
      const next = new EventSource(appPath(path + "/events")); source = next;
      next.addEventListener("snapshot", event => {
        if (disposed || source !== next) return;
        lastEvent = Date.now(); setConnection("实时同步");
        try { consume(JSON.parse((event as MessageEvent).data)); } catch { next.close(); source = undefined; }
      });
      next.addEventListener("heartbeat", () => { if (!disposed && source === next) { lastEvent = Date.now(); setConnection("实时同步"); } });
      next.addEventListener("expired", () => { next.close(); source = undefined; void refresh(); });
      next.onerror = () => {
        if (disposed || source !== next) return;
        next.close(); if (source === next) source = undefined;
        if (!disposed && !ended) setConnection("定时同步 · 正在重连");
      };
    };
    const refresh = async () => {
      if (disposed || fetching || authFailed || document.hidden) return;
      fetching = true;
      try {
        const next = await classroomFetch<T>(path, undefined, AbortSignal.any([abort.signal, AbortSignal.timeout(12_000)]));
        consume(next);
        if (!disposed && !ended) { if (!source) setConnection("定时同步"); if (Date.now() - lastConnect >= 8000) connect(); }
      } catch (err) { failure(err); }
      finally { fetching = false; }
    };
    refreshRef.current = () => { authFailed = false; setExpired(false); void refresh(); };
    const resume = () => {
      source?.close(); source = undefined;
      if (document.hidden) setConnection("后台暂停"); else { lastConnect = 0; void refresh(); }
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    void refresh();
    const timer = setInterval(() => {
      if (disposed || ended || authFailed || document.hidden) return;
      if (source && Date.now() - lastEvent > 35_000) { source.close(); source = undefined; }
      if (!source) void refresh();
    }, 4000);
    return () => {
      disposed = true; abort.abort(); source?.close(); clearInterval(timer); refreshRef.current = () => {};
      document.removeEventListener("visibilitychange", resume); window.removeEventListener("online", resume);
    };
  }, [id, student, active, accept]);
  return { state, connection, error, expired, accept, refresh: () => refreshRef.current() };
}
