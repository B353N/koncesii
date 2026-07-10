import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Снапшотът е директория с изхода на tools/harvest (docs/etl.md):
 *   nkr_data/export_concessions_raw.tsv      (windows-1251 — оригиналът)
 *   nkr_data/html/{guid}/partida.html
 *   nkr_data/html/{guid}/{Вид}_{docguid}.html
 *   data/raw/{dataset_uri}/_dataset.json
 *   data/raw/{dataset_uri}/{resource_uri}.json
 *
 * Единствената не-UTF-8 точка в цялата система е суровият НКР експорт —
 * така го връща регистърът. Декодираме го веднъж на входа; всичко след
 * тази граница (staging, базата, JSON, сайтът) е UTF-8.
 */
export interface Snapshot {
  /** Датиран етикет на снемането (YYYY-MM-DD) — влиза в source префиксите. */
  date: string;
  exportTsv: Uint8Array | null;
  /** guid → { partidaHtml, документи: име на файл → html } */
  lots: Map<string, { partidaHtml: string | null; docs: Map<string, string> }>;
  /** dataset_uri → { meta, ресурси: resource_uri → payload } */
  egov: Map<string, { meta: unknown; resources: Map<string, unknown> }>;
}

export function loadSnapshot(dir: string, date: string): Snapshot {
  const snap: Snapshot = {
    date,
    exportTsv: null,
    lots: new Map(),
    egov: new Map(),
  };

  for (const name of ["export_concessions_raw.tsv", "export_concessions.tsv"]) {
    const p = join(dir, "nkr_data", name);
    if (existsSync(p)) {
      snap.exportTsv = new Uint8Array(readFileSync(p));
      break;
    }
  }

  const htmlDir = join(dir, "nkr_data", "html");
  if (existsSync(htmlDir)) {
    for (const guid of readdirSync(htmlDir).sort()) {
      const lotDir = join(htmlDir, guid);
      const docs = new Map<string, string>();
      let partidaHtml: string | null = null;
      for (const f of readdirSync(lotDir).sort()) {
        if (!f.endsWith(".html")) continue;
        const html = readFileSync(join(lotDir, f), "utf8");
        if (f === "partida.html") partidaHtml = html;
        else docs.set(f.replace(/\.html$/, ""), html);
      }
      snap.lots.set(guid, { partidaHtml, docs });
    }
  }

  const rawDir = join(dir, "data", "raw");
  if (existsSync(rawDir)) {
    for (const ds of readdirSync(rawDir).sort()) {
      const dsDir = join(rawDir, ds);
      const metaPath = join(dsDir, "_dataset.json");
      if (!existsSync(metaPath)) continue;
      const meta = JSON.parse(readFileSync(metaPath, "utf8")) as unknown;
      const resources = new Map<string, unknown>();
      for (const f of readdirSync(dsDir).sort()) {
        if (f === "_dataset.json" || !f.endsWith(".json")) continue;
        resources.set(
          f.replace(/\.json$/, ""),
          JSON.parse(readFileSync(join(dsDir, f), "utf8")),
        );
      }
      snap.egov.set(ds, { meta, resources });
    }
  }

  return snap;
}
