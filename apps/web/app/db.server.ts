import { existsSync } from "node:fs";
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
  // При атомарна подмяна на файла inode-ът се сменя — преотваряме при нужда.
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
  return handle;
}

export function dbPath(): string | null {
  return openedPath;
}
