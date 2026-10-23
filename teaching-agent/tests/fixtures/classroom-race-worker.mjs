import { randomUUID } from "node:crypto";
import { ClassroomStore } from "../../src/lib/classroom/store.ts";
const [path, action, owner, id, round, token, answer] = process.argv.slice(2);
const store = new ClassroomStore(path);
if (process.send) { process.send("ready"); await new Promise(resolve => process.once("message", resolve)); }
try {
  if (action === "answer") store.answer(token, id, round, answer, randomUUID());
  else store.changeRound(owner, id, round, "close");
  console.log(JSON.stringify({ ok: true }));
} catch (error) {
  if (error.status !== 409) throw error;
  console.log(JSON.stringify({ ok: false, status: error.status }));
} finally { store.close(); process.disconnect?.(); }
