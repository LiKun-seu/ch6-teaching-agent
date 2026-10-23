// Run with the deployment Node.js 24 runtime. Contains no application/session secrets.
import { DatabaseSync, backup } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
const [command, databasePath, target] = process.argv.slice(2);
if (!["check", "backup"].includes(command) || !databasePath || !path.isAbsolute(databasePath) || !fs.existsSync(databasePath)) throw new Error("Usage: node deploy/classroom-db.mjs check|backup <existing-absolute-db> [new-absolute-backup]");
const db = new DatabaseSync(databasePath, { readOnly: true });
try {
  if (command === "check") {
    console.log(JSON.stringify({ schema: db.prepare("PRAGMA user_version").get(), integrity: db.prepare("PRAGMA quick_check").all(), foreignKeys: db.prepare("PRAGMA foreign_key_check").all() }));
  } else {
    if (!target || !path.isAbsolute(target) || fs.existsSync(target)) throw new Error("Backup target must be a new absolute path");
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o750 });
    await backup(db, target);
    fs.chmodSync(target, 0o640);
    console.log("SQLite online backup complete");
  }
} finally { db.close(); }
