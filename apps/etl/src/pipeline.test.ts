import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  buildFixtureSnapshot,
  FIXTURE_DATE as DATE,
  FIXTURE_DOC_GUID as DOC_GUID,
  FIXTURE_LOT_GUID as LOT_GUID,
} from "./fixtureSnapshot";
import { runIngest } from "./ingest";
import { verifyReport, type IntegrityReport } from "./report";

let work: string;
let snapshotDir: string;
let report: IntegrityReport;
let dbPath: string;

beforeAll(() => {
  work = join(tmpdir(), `koncesii-etl-test-${process.pid}`);
  rmSync(work, { recursive: true, force: true });
  snapshotDir = join(work, "snapshot");
  buildFixtureSnapshot(snapshotDir);

  dbPath = join(work, "koncesii.sqlite");
  report = runIngest(snapshotDir, DATE, dbPath).report;
});

afterAll(() => rmSync(work, { recursive: true, force: true }));

test("трите НКР партиди + самостоятелният egov запис влизат в единния модел", () => {
  expect(report.tables["concessions"]).toBe(4); // 3 НКР + 1 само от общинския регистър
  expect(report.tables["grantors"]).toBe(2); // Община Смолян, Министър на земеделието
  expect(report.tables["raw_nkr_export"]).toBe(3); // индексът, staged като база
  expect(report.tables["raw_egov_rows"]).toBe(2);
});

test("обявлението обогатява концесията; всяка стойност пази суров низ и флаг", () => {
  const db = new Database(dbPath, { readonly: true });
  const c = db
    .prepare("SELECT * FROM concessions WHERE id = 'k:O-000123'")
    .get() as Record<string, unknown>;
  db.close();

  expect(c["term_months"]).toBe(420);
  expect(c["term_flag"]).toBe("ok");
  expect(c["annual_payment_raw"]).toBe("259,75 лв.");
  expect(c["annual_payment_eur"]).toBeCloseTo(259.75 / 1.95583, 2);
  expect(c["value_raw"]).toBe("41 967,34 лв.");
  expect(c["onetime_payment_flag"]).toBe("missing"); // „Няма въведени данни“
  expect(c["source_url"]).toContain(LOT_GUID); // произход: партидата
  expect(c["announcement_url"]).toContain(DOC_GUID);
});

test("флаговете са аритметични факти с формулата в inputs", () => {
  const db = new Database(dbPath, { readonly: true });
  const flags = db
    .prepare(
      "SELECT code, severity, inputs FROM flags WHERE concession_id = 'k:O-000123' ORDER BY code",
    )
    .all() as Array<{ code: string; severity: string; inputs: string }>;
  db.close();

  expect(flags.map((f) => f.code)).toEqual(["LONG_TERM", "LOW_PAYMENT"]);
  const low = JSON.parse(flags[1]!.inputs) as Record<string, number>;
  expect(low["ratio"]).toBeLessThan(0.01);
  expect(low["annual_payment_eur"]).toBeCloseTo(259.75 / 1.95583, 2);
  const long = JSON.parse(flags[0]!.inputs) as Record<string, number>;
  expect(long["term_months"]).toBe(420);
  expect(long["level"]).toBe(2); // ≥ 420 месеца
});

test("концесионерът идва от обявлението: име + ЕИК от Раздел VI", () => {
  const db = new Database(dbPath, { readonly: true });
  const co = db
    .prepare(
      "SELECT co.name, co.eik FROM concessions c JOIN concessionaires co ON co.id = c.concessionaire_id WHERE c.id = 'k:O-000123'",
    )
    .get() as { name: string; eik: string };
  db.close();
  expect(co.eik).toBe("123456789");
  expect(co.name).toContain("Рибовъдство Родопи");
});

test("egov плащане за съществуваща концесия остава в payments с произход", () => {
  const db = new Database(dbPath, { readonly: true });
  const payments = db
    .prepare("SELECT concession_id, source_url FROM payments ORDER BY id")
    .all() as Array<{ concession_id: string; source_url: string }>;
  db.close();
  expect(payments).toHaveLength(1);
  expect(payments[0]!.concession_id).toBe("k:O-000123");
  expect(payments[0]!.source_url).toContain("data.egov.bg");
});

test("egov ред без съвпадение по ЕИК става самостоятелен запис с произход egov", () => {
  const db = new Database(dbPath, { readonly: true });
  const c = db
    .prepare(
      "SELECT source, source_url, annual_payment_eur, term_months FROM concessions WHERE source = 'egov'",
    )
    .get() as {
    source: string;
    source_url: string;
    annual_payment_eur: number;
    term_months: number;
  };
  db.close();
  expect(c.source_url).toContain("data.egov.bg");
  expect(c.annual_payment_eur).toBeCloseTo(2300.81 / 1.95583, 2);
  expect(c.term_months).toBe(300); // „25“ → 25 години
});

test("запис без пари получава MISSING_MONEY, не нула", () => {
  const db = new Database(dbPath, { readonly: true });
  const codes = db
    .prepare("SELECT code FROM flags WHERE concession_id = 'k:O-000391'")
    .all() as Array<{ code: string }>;
  db.close();
  expect(codes.map((c) => c.code)).toContain("MISSING_MONEY");
});

test("integrity отчетът се сверява срещу самата база", () => {
  const db = new Database(dbPath, { readonly: true });
  expect(verifyReport(db, report)).toEqual([]);
  expect(report.flagged_concessions).toBeGreaterThan(0);
  db.close();
});

test("детерминизъм: същият снапшот дава байт-идентична база", () => {
  const second = join(work, "koncesii-2.sqlite");
  runIngest(snapshotDir, DATE, second);
  const sha = (p: string) =>
    createHash("sha256").update(readFileSync(p)).digest("hex");
  expect(sha(second)).toBe(sha(dbPath));
});
