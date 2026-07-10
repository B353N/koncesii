import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";

/**
 * Базата е един SQLite файл, произведен от pnpm ingest (ADR-0005), който
 * сайтът чете строго read-only и само с bound параметри. Пътят идва от
 * KONCESII_DB; по подразбиране — фикстурната база от pnpm setup. Липсваща
 * база не чупи сайта: маршрутите показват „данните се подготвят".
 */
let handle: Database.Database | null | undefined;
let openedPath: string | null = null;
let openedIno: bigint | null = null;
let lastCheck = 0;
const RECHECK_MS = 5000;

function candidatePaths(): string[] {
  const env = process.env["KONCESII_DB"];
  if (env) return [env];
  return [
    resolve(process.cwd(), "build/koncesii.local.sqlite"),
    resolve(process.cwd(), "../../build/koncesii.local.sqlite"),
    "/data/koncesii/koncesii.sqlite",
  ];
}

export function getDb(): Database.Database | null {
  // При атомарна подмяна (mv) inode-ът се сменя, а старият handle сочи
  // стария файл — проверяваме периодично и преотваряме при смяна.
  const now = Date.now();
  if (handle && openedPath && now - lastCheck > RECHECK_MS) {
    lastCheck = now;
    try {
      const ino = statSync(openedPath, { bigint: true }).ino;
      if (ino !== openedIno) {
        handle.close();
        handle = undefined;
      }
    } catch {
      handle?.close();
      handle = undefined;
    }
  }

  if (handle !== undefined) {
    if (handle === null && candidatePaths().some(existsSync))
      handle = undefined;
    else return handle;
  }
  const path = candidatePaths().find(existsSync);
  if (!path) {
    handle = null;
    return null;
  }
  handle = new Database(path, { readonly: true, fileMustExist: true });
  openedPath = path;
  openedIno = statSync(path, { bigint: true }).ino;
  lastCheck = now;
  return handle;
}

export function dbPath(): string | null {
  return openedPath;
}
