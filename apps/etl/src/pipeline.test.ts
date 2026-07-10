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

test("трите НКР партиди влизат в единния модел, без дубликати от egov", () => {
  expect(report.tables["concessions"]).toBe(3);
  expect(report.tables["grantors"]).toBe(2); // Община Смолян, Министър на земеделието
  expect(report.tables["raw_nkr_export"]).toBe(3);
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

test("egov допълва липсващо възнаграждение по ЕИК, с произход в payments", () => {
  const db = new Database(dbPath, { readonly: true });
  const c = db
    .prepare(
      "SELECT annual_payment_eur, annual_payment_flag FROM concessions WHERE id = 'k:D-000078'",
    )
    .get() as { annual_payment_eur: number; annual_payment_flag: string };
  const payments = db
    .prepare("SELECT source_url FROM payments ORDER BY id")
    .all() as Array<{ source_url: string }>;
  db.close();

  expect(c.annual_payment_eur).toBeCloseTo(2300.81 / 1.95583, 2);
  expect(c.annual_payment_flag).toBe("parsed_from_text");
  expect(payments).toHaveLength(2);
  expect(payments[0]!.source_url).toContain("data.egov.bg");
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
