import type Database from "better-sqlite3";
import {
  normText,
  normalizeResource,
  parseNkrExport,
  parsePartida,
  parsePreview,
  previewMeta,
} from "ingest";
import type { Snapshot } from "./snapshot";

/**
 * Staging: суровите файлове от снапшота влизат 1:1 в raw_* таблиците,
 * с source префикса по конвенцията от docs/etl.md. Нищо не се тълкува
 * тук отвъд парсването на формàта — тълкуването е в unify.
 */

const REG_NUM_HEADER_RE = /номер.*партида|партиден.*номер|рег.*номер|^номер$/i;

/**
 * Базовите редове идват от TSV експорта, когато го има, иначе от
 * Search индекса (nkr_data/index/concessions.jsonl). Индексът носи и guid,
 * който свързва реда директно с партидата — експортът на НКР от 07.2026
 * връща 500, така че индексът е реалният път.
 */
export function stageNkrExport(db: Database.Database, snap: Snapshot): number {
  const insert = db.prepare(
    "INSERT INTO raw_nkr_export (source, reg_num, payload, fetched_at) VALUES (?, ?, ?, ?)",
  );
  let n = 0;

  if (snap.exportTsv) {
    const { headers, rows } = parseNkrExport(snap.exportTsv);
    const regNumHeader =
      headers.find((h) => REG_NUM_HEADER_RE.test(h)) ?? headers[0] ?? "col_0";
    const source = `nkr:export:${snap.date}`;
    for (const row of rows) {
      const regNum = row[regNumHeader];
      if (!regNum) continue;
      insert.run(source, regNum, JSON.stringify(row), snap.date);
      n++;
    }
    return n;
  }

  const source = `nkr:index:${snap.date}`;
  for (const row of snap.indexRows) {
    const regNumKey = Object.keys(row).find((k) => REG_NUM_HEADER_RE.test(k));
    const regNum = regNumKey ? normText(row[regNumKey]) : "";
    if (!regNum) continue;
    insert.run(source, regNum, JSON.stringify(row), snap.date);
    n++;
  }
  return n;
}

export interface StagedLot {
  guid: string;
  regNum: string | null;
  fileLinks: string[];
  announcementUrls: string[];
}

const PARTIDA_REG_RE = /партида\s+на\s+концесия\s+(\S+)/iu;

export function stageNkrLots(
  db: Database.Database,
  snap: Snapshot,
): StagedLot[] {
  const insert = db.prepare(
    "INSERT INTO raw_nkr_announcements (source, guid, reg_num, payload, fetched_at) VALUES (?, ?, ?, ?, ?)",
  );
  const lots: StagedLot[] = [];

  for (const [guid, lot] of [...snap.lots].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    let regNum: string | null = null;
    let fileLinks: string[] = [];
    const announcementUrls: string[] = [];

    if (lot.partidaHtml) {
      const partida = parsePartida(lot.partidaHtml);
      fileLinks = partida.fileLinks;
      const m = partida.title ? PARTIDA_REG_RE.exec(partida.title) : null;
      regNum = m?.[1] ?? null;
    }

    for (const [docName, html] of [...lot.docs].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const parsed = parsePreview(html);
      const meta = previewMeta(`/Preview/${docName.replace("_", "/")}`);
      insert.run(
        `nkr:assigned:${guid}:${snap.date}`,
        guid,
        regNum,
        JSON.stringify({ doc: docName, kind: meta?.kind ?? null, ...parsed }),
        snap.date,
      );
      if (docName.startsWith("AssignedConcession")) {
        const docGuid = docName.split("_")[1];
        if (docGuid) {
          announcementUrls.push(
            `https://nkr.government.bg/Preview/AssignedConcession/${docGuid}`,
          );
        }
      }
    }

    lots.push({ guid, regNum, fileLinks, announcementUrls });
  }
  return lots;
}

/**
 * Набори, които са огледала на самия НКР (общини качват националния регистър
 * като свой набор). НКР го имаме от първа ръка — огледалата не влизат дори в
 * staging (58 117 от 59 057 egov реда в harvest-а от 07.2026 са огледала и
 * издуват сервиращата база), детерминистично по името на набора. Броят се
 * пази и се отчита в ingest лога.
 */
const NKR_MIRROR_RE = /национален концесионен регистър/iu;

export interface EgovStagingResult {
  unmapped: Map<string, string[]>;
  mirrorsSkipped: number;
}

export function stageEgov(
  db: Database.Database,
  snap: Snapshot,
): EgovStagingResult {
  const insert = db.prepare(
    "INSERT INTO raw_egov_rows (source, resource_uri, row_index, payload, fetched_at) VALUES (?, ?, ?, ?, ?)",
  );
  const unmapped = new Map<string, string[]>();
  let mirrorsSkipped = 0;

  for (const [dsUri, ds] of [...snap.egov].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const meta = ds.meta as {
      uri?: string;
      name?: string;
      source?: string;
      updated_at?: string;
    };
    const isMirror = NKR_MIRROR_RE.test(normText(meta.name));
    for (const [resUri, payload] of [...ds.resources].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const { records, unmapped: unmappedHeaders } = normalizeResource(
        payload,
        meta,
        resUri,
      );
      if (isMirror) {
        mirrorsSkipped += records.length;
        continue;
      }
      if (unmappedHeaders.length > 0) {
        unmapped.set(
          `${normText(meta.name) || dsUri} (${resUri})`,
          unmappedHeaders,
        );
      }
      records.forEach((rec, i) => {
        insert.run(
          `egov:${resUri}:v1`,
          resUri,
          i,
          JSON.stringify(rec),
          snap.date,
        );
      });
    }
  }
  return { unmapped, mirrorsSkipped };
}
