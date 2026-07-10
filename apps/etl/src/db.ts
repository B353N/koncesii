import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../packages/db/migrations",
);

/** Създава чиста база и прилага каноничната схема (0000_init.sql). */
export function createDatabase(outPath: string): Database.Database {
  mkdirSync(dirname(outPath), { recursive: true });
  rmSync(outPath, { force: true });
  const db = new Database(outPath);
  db.pragma("journal_mode = MEMORY"); // без -wal/-shm артефакти; билдът е еднократен
  db.exec(readFileSync(join(MIGRATIONS_DIR, "0000_init.sql"), "utf8"));
  return db;
}
