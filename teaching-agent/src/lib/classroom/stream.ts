import "server-only";
import { ClassroomError, type ClassroomStore } from "./store";
import type { Snapshot } from "./types";

/** Snapshot-only cursors intentionally accept any Last-Event-ID: the latest DB view is authoritative. */
export function classroomEvents(req: Request, store: ClassroomStore, classroomId: string, sessionKey: string, snapshot: () => Snapshot, maxStreams: number) {
  const initial = snapshot();
  const lease = store.lease(sessionKey, maxStreams);
  let dispose = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let finished = false, version = initial.classroom.version, lastHeartbeat = Date.now();
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown, id?: number) => controller.enqueue(encoder.encode(`${id === undefined ? "" : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      let timer: ReturnType<typeof setInterval>;
      const finish = () => {
        if (finished) return;
        finished = true; clearInterval(timer); req.signal.removeEventListener("abort", finish);
        store.run("DELETE FROM stream_leases WHERE id=?", lease);
        try { controller.close(); } catch { /* Already canceled by reader. */ }
      };
      dispose = finish;
      send("snapshot", initial, version);
      if (initial.classroom.status === "ended") { finish(); return; }
      timer = setInterval(() => {
        try {
          if ((controller.desiredSize ?? 0) <= 0) { finish(); return; }
          const now = Date.now();
          const current = Number(store.get("SELECT version FROM classrooms WHERE id=?", classroomId)?.version);
          const heartbeat = now - lastHeartbeat >= 20_000;
          if (current > version || heartbeat) {
            const state = snapshot(); // Rechecks authorization/expiry, including on idle heartbeats.
            if (state.classroom.version > version) { version = state.classroom.version; send("snapshot", state, version); }
            if (heartbeat) {
              send("heartbeat", { version }); lastHeartbeat = now;
              store.run("UPDATE stream_leases SET expires_at=? WHERE id=?", now + 45_000, lease);
            }
            if (state.classroom.status === "ended") finish();
          }
        } catch (error) {
          send("expired", { error: error instanceof ClassroomError ? error.message : "实时同步暂不可用" }); finish();
        }
      }, 500);
      req.signal.addEventListener("abort", finish, { once: true });
      if (req.signal.aborted) finish();
    },
    cancel() { dispose(); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
}
