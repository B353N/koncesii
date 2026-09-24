import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { applyChangeTracking, readPreviousState } from "./changes";
import { createDatabase } from "./db";
import { ingestDocuments, type DocumentStats } from "./documents";
import { loadSnapshot, type Snapshot } from "./snapshot";
import { stageEgov, stageNkrExport, stageNkrLots } from "./staging";
import { unify } from "./unify";
import { deriveFlags } from "./flags";
import { integrityReport, type IntegrityReport } from "./report";

/**
 * pnpm ingest — снапшот → staging → unify → derive flags → precompute →
 * build/koncesii.sqlite + integrity отчет. Детерминистично: един и същи
 * снапшот дава байт-идентична база (датата идва от снапшота, не от clock-а).
 *
 *   pnpm ingest --local <dir> --date YYYY-MM-DD [--out build/koncesii.sqlite]
 *   pnpm ingest --snapshot YYYY-MM-DD   (тегли от сървъра, после като --local)
 */

/** Изходите отиват в build/ на корена на репото, независимо от cwd. */
const BUILD_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
  "build",
);

export interface IngestResult {
  report: IntegrityReport;
  unmappedHeaders: Record<string, string[]>;
  mirrorsSkipped: number;
  /** Разбивка спрямо предишната база: нови / променени / непроменени. */
  changes: { added: number; changed: number; unchanged: number };
  /** Документите: текст, страници, извлечени и приложени клаузи. */
  documents: DocumentStats;
}

export function runIngest(
  snapshotDir: string,
  date: string,
  outPath: string,
  /**
   * Предишната публикувана база: от нея се пренася `changed_at` на
   * непроменените партиди. По подразбиране това е самият изходен файл,
   * ако вече съществува. null изключва сравнението.
   */
  previousPath: string | null = outPath,
): IngestResult {
  const snap: Snapshot = loadSnapshot(snapshotDir, date);
  // Празен снапшот означава сгрешен път (--local се разрешава спрямо
  // apps/etl, не спрямо корена). Без тази проверка ingest-ът успява с
  // нула реда и db:push публикува празна база - отчетът съвпада, защото
  // е изчислен от същия празен билд.
  if (
    snap.exportTsv === null &&
    snap.indexRows.length === 0 &&
    snap.lots.size === 0 &&
    snap.egov.size === 0
  ) {
    throw new Error(
      `[ingest] празен снапшот в ${snapshotDir} - няма nkr_data/ и data/. ` +
        `Пътят на --local се разрешава спрямо текущата директория; подайте абсолютен път.`,
    );
  }
  // чете се преди createDatabase — тя трие изходния файл
  const previous = readPreviousState(previousPath);
  const db: Database.Database = createDatabase(outPath);

  try {
    let report!: IntegrityReport;
    let egov!: ReturnType<typeof stageEgov>;
    let changes!: ReturnType<typeof applyChangeTracking>;
    let documents!: DocumentStats;

    db.transaction(() => {
      const nExport = stageNkrExport(db, snap);
      const lots = stageNkrLots(db, snap);
      egov = stageEgov(db, snap);
      const stats = unify(db, lots, date);
      // текстът на документите попълва само останалите липсващи полета —
      // преди индикаторите, за да влязат попълнените стойности във формулите
      documents = ingestDocuments(db, snap, date);
      console.log(
        `[ingest] документи: ${documents.documents} файла, ${documents.withText} с текст, ` +
          `${documents.pages} страници (${documents.ocrPages} с OCR), ` +
          `клаузи: ${documents.facts} (попълнени ${documents.filled}, съвпадат ${documents.agrees}, ` +
          `разминавания ${documents.conflicts}), суми: ${documents.amounts}`,
      );
      const nFlags = deriveFlags(db, date);

      // свежест: кои партиди наистина са се променили спрямо предишната
      // база — датата влиза в sitemap-а като lastmod
      changes = applyChangeTracking(db, previous, date);
      console.log(
        `[ingest] промени спрямо предишната база: ${changes.added} нови, ` +
          `${changes.changed} променени, ${changes.unchanged} без промяна` +
          (previous.size === 0 ? " (няма предишна база)" : ""),
      );

      // precompute: GeoJSON за картата (центроиди, приблизителни)
      const points = db
        .prepare<
          [],
          {
            reg_num: string;
            title: string;
            kind: string;
            lat: number;
            lon: number;
            geo_precision: string;
          }
        >(
          `SELECT c.reg_num, c.title, o.kind, o.lat, o.lon, o.geo_precision
           FROM objects o JOIN concessions c ON c.id = o.concession_id
           WHERE o.lat IS NOT NULL ORDER BY c.reg_num`,
        )
        .all();
      db.prepare(
        "INSERT INTO rollups (key, payload, computed_at) VALUES ('map_geojson', ?, ?)",
      ).run(
        JSON.stringify({
          type: "FeatureCollection",
          features: points.map((p) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [p.lon, p.lat] },
            properties: {
              reg_num: p.reg_num,
              title: p.title.length > 90 ? p.title.slice(0, 90) + "…" : p.title,
              kind: p.kind,
              precision: p.geo_precision,
            },
          })),
        }),
        date,
      );
      console.log(`[ingest] карта: ${points.length} гео-кодирани обекта`);

      // precompute: обобщението за началната страница
      report = integrityReport(db, date);
      db.prepare(
        "INSERT INTO rollups (key, payload, computed_at) VALUES ('summary', ?, ?)",
      ).run(
        JSON.stringify({
          data_date: date,
          concessions: report.tables["concessions"],
          grantors: report.tables["grantors"],
          concessionaires: report.tables["concessionaires"],
          flagged: report.flagged_concessions,
        }),
        date,
      );
      report = integrityReport(db, date); // финалният отчет включва и rollups

      console.log(
        `[ingest] export: ${nExport} реда, партиди: ${lots.length}, ` +
          `концесии: ${stats.concessions} (НКР ${stats.fromNkr}, egov ${stats.fromEgov}), ` +
          `допълнени: ${stats.supplemented}, конфликти: ${stats.conflicts}, ` +
          `огледала прескочени: ${egov.mirrorsSkipped}, ` +
          `празни egov реда: ${stats.egovSkippedEmpty}, флагове: ${nFlags}`,
      );
    })();

    return {
      report,
      unmappedHeaders: Object.fromEntries(egov.unmapped),
      mirrorsSkipped: egov.mirrorsSkipped,
      changes,
      documents,
    };
  } finally {
    db.close();
  }
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  const v = i !== -1 ? process.argv[i + 1] : undefined;
  return v && !v.startsWith("--") ? v : null;
}

async function main() {
  const local = arg("--local");
  const snapshotDate = arg("--snapshot");
  const fixtures = process.argv.includes("--fixtures");
  const out = arg("--out") ?? join(BUILD_DIR, "koncesii.sqlite");
  // --previous <db> сверява спрямо друга база; --no-previous я изключва
  const previous = process.argv.includes("--no-previous")
    ? null
    : (arg("--previous") ?? out);

  let dir: string;
  let date: string;

  if (fixtures) {
    // локална база от фикстурите — контрибуторите нямат достъп до регистрите
    const { buildFixtureSnapshot, FIXTURE_DATE } =
      await import("./fixtureSnapshot");
    dir = join(BUILD_DIR, "snapshots", "fixtures");
    date = FIXTURE_DATE;
    buildFixtureSnapshot(dir);
  } else if (local) {
    dir = local;
    date = arg("--date") ?? "local";
  } else if (snapshotDate) {
    // тегли снапшота от сървъра (виж docs/etl.md; конфигурация през env)
    const host = process.env["KONCESII_SSH_HOST"] ?? "imprya";
    const remote = `${host}:/data/koncesii/snapshots/${snapshotDate}/`;
    dir = join(BUILD_DIR, "snapshots", snapshotDate);
    date = snapshotDate;
    const { execFileSync } = await import("node:child_process");
    console.log(`[ingest] rsync ${remote} → ${dir}`);
    // Оригиналите на документите (GB) не трябват на ingest — той чете
    // само манифеста и текстовия кеш nkr_data/text/ от pnpm extract.
    execFileSync(
      "rsync",
      ["-rtz", "--delete", "--exclude=/nkr_data/files/", remote, dir + "/"],
      {
        stdio: "inherit",
      },
    );
  } else {
    console.error(
      "употреба: pnpm ingest --local <dir> --date YYYY-MM-DD | --snapshot YYYY-MM-DD | --fixtures [--out <file>] [--previous <db> | --no-previous]",
    );
    process.exit(2);
  }

  const { report, unmappedHeaders } = runIngest(dir, date, out, previous);

  writeFileSync(
    join(BUILD_DIR, "ingest-report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  if (Object.keys(unmappedHeaders).length > 0) {
    writeFileSync(
      join(BUILD_DIR, "unmapped_headers.json"),
      JSON.stringify(unmappedHeaders, null, 2) + "\n",
    );
    console.log(
      `[ingest] неразпознати хедъри: ${Object.keys(unmappedHeaders).length} ресурса → build/unmapped_headers.json`,
    );
  }
  console.log(JSON.stringify(report, null, 2));
  console.log(`[ingest] готово → ${out}`);
}

if (process.argv[1]?.endsWith("ingest.ts")) {
  await main();
}
