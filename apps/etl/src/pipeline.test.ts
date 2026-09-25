import { createHash } from "node:crypto";
import { copyFileSync, readFileSync, rmSync } from "node:fs";
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
import { runIngest, type IngestResult } from "./ingest";
import { verifyReport, type IntegrityReport } from "./report";

let work: string;
let snapshotDir: string;
let result: IngestResult;
let report: IntegrityReport;
let dbPath: string;

beforeAll(() => {
  work = join(tmpdir(), `koncesii-etl-test-${process.pid}`);
  rmSync(work, { recursive: true, force: true });
  snapshotDir = join(work, "snapshot");
  buildFixtureSnapshot(snapshotDir);

  dbPath = join(work, "koncesii.sqlite");
  result = runIngest(snapshotDir, DATE, dbPath);
  report = result.report;
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
  // НКР формулярите са в евро въпреки „лв." (nkrMoney в unify.ts)
  expect(c["annual_payment_eur"]).toBe(259.75);
  expect(c["value_raw"]).toBe("41 967,34 лв.");
  // „Няма въведени данни“ в обявлението → попълнено от договора (виж по-долу)
  expect(c["onetime_payment_flag"]).toBe("parsed_from_text");
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

  // GRACE_PERIOD: гратисният период (24 мес.) идва от договора
  expect(flags.map((f) => f.code)).toEqual([
    "GRACE_PERIOD",
    "LONG_TERM",
    "LOW_PAYMENT",
  ]);
  const low = JSON.parse(flags[2]!.inputs) as Record<string, number>;
  expect(low["ratio"]).toBeLessThan(0.01);
  expect(low["annual_payment_eur"]).toBe(259.75);
  const long = JSON.parse(flags[1]!.inputs) as Record<string, number>;
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

test("огледалата на НКР от data.egov.bg не влизат дори в staging", () => {
  // фикстурата има огледален набор „Национален концесионен регистър…“ с
  // 2 реда — stageEgov ги прескача (в реалния harvest от 10.07.2026 те са
  // 58 117 от 59 057 egov реда и издуват сервиращата база), но броят се
  // отчита. Редовете не създават нито raw_egov_rows, нито концесии.
  expect(result.mirrorsSkipped).toBe(2);
  expect(report.tables["raw_egov_rows"]).toBe(2); // само истинският набор

  const db = new Database(dbPath, { readonly: true });
  const egovCount = db
    .prepare("SELECT COUNT(*) AS n FROM concessions WHERE source = 'egov'")
    .get() as { n: number };
  db.close();
  expect(egovCount.n).toBe(1); // само истинският общински ред
});

test("детерминизъм: същият снапшот дава байт-идентична база", () => {
  const second = join(work, "koncesii-2.sqlite");
  runIngest(snapshotDir, DATE, second);
  const sha = (p: string) =>
    createHash("sha256").update(readFileSync(p)).digest("hex");
  expect(sha(second)).toBe(sha(dbPath));
});

test("промените се проследяват спрямо предишната база", () => {
  const first = join(work, "changes-1.sqlite");
  runIngest(snapshotDir, "2026-07-10", first, null);

  const read = (path: string) => {
    const db = new Database(path, { readonly: true });
    const rows = db
      .prepare(
        "SELECT reg_num, content_hash, changed_at FROM concessions ORDER BY reg_num",
      )
      .all() as Array<{
      reg_num: string;
      content_hash: string;
      changed_at: string;
    }>;
    db.close();
    return rows;
  };

  const before = read(first);
  expect(before.length).toBeGreaterThan(0);
  expect(before.every((r) => r.changed_at === "2026-07-10")).toBe(true);
  expect(before.every((r) => r.content_hash.length === 32)).toBe(true);

  // същият снапшот на по-късна дата: нищо не се е променило, датите стоят
  const second = join(work, "changes-2.sqlite");
  const again = runIngest(snapshotDir, "2026-08-01", second, first);
  expect(again.changes.changed).toBe(0);
  expect(again.changes.added).toBe(0);
  expect(again.changes.unchanged).toBe(before.length);
  expect(read(second).every((r) => r.changed_at === "2026-07-10")).toBe(true);

  // променено съдържание → новата дата
  const edited = join(work, "changes-edited.sqlite");
  copyFileSync(first, edited);
  const w = new Database(edited);
  w.prepare(
    "UPDATE concessions SET content_hash = 'deadbeefdeadbeefdeadbeefdeadbeef' WHERE reg_num = 'O-000123'",
  ).run();
  w.close();
  const third = join(work, "changes-3.sqlite");
  const diff = runIngest(snapshotDir, "2026-08-01", third, edited);
  expect(diff.changes.changed).toBe(1);
  const changed = read(third).find((r) => r.reg_num === "O-000123");
  expect(changed?.changed_at).toBe("2026-08-01");
});

test("без предишна база всичко е ново и с датата на снапшота", () => {
  const only = join(work, "changes-fresh.sqlite");
  const res = runIngest(snapshotDir, "2026-09-22", only, null);
  expect(res.changes.unchanged).toBe(0);
  expect(res.changes.changed).toBe(0);
  expect(res.changes.added).toBe(report.tables["concessions"]);
});

test("документите: метаданни от манифеста, текст по страници, метод", () => {
  const db = new Database(dbPath, { readonly: true });
  const docs = db
    .prepare(
      `SELECT title, url, text_status, text_method, page_count, sha256
       FROM documents WHERE concession_id = 'k:O-000123' AND kind = 'file' ORDER BY url`,
    )
    .all() as Array<Record<string, unknown>>;
  const pages = db
    .prepare(
      "SELECT d.title, p.page, p.method FROM document_pages p JOIN documents d ON d.id = p.document_id ORDER BY d.url, p.page",
    )
    .all();
  db.close();

  expect(docs).toMatchObject([
    {
      title: "Решение № 714",
      url: "https://nkr.government.bg/Content/Download/reshenie-714.pdf",
      text_status: "ok",
      text_method: "ocr",
      page_count: 1,
    },
    {
      title: "Концесионен договор (PDF)",
      text_status: "ok",
      text_method: "text",
      page_count: 2,
    },
  ]);
  expect(docs[1]!["sha256"]).toMatch(/^[0-9a-f]{64}$/);
  expect(pages).toEqual([
    { title: "Решение № 714", page: 1, method: "ocr" },
    { title: "Концесионен договор (PDF)", page: 1, method: "text" },
    { title: "Концесионен договор (PDF)", page: 2, method: "text" },
  ]);
});

test("пълнотекстово търсене в документите, с префикс и без значение от регистъра", () => {
  const db = new Database(dbPath, { readonly: true });
  const hits = db
    .prepare(
      `SELECT d.title, p.page FROM document_pages_fts f
       JOIN document_pages p ON p.id = f.rowid
       JOIN documents d ON d.id = p.document_id
       WHERE document_pages_fts MATCH ? ORDER BY d.url, p.page`,
    )
    .all('"гратисни"*') as Array<{ title: string; page: number }>;
  const eik = db
    .prepare(
      "SELECT COUNT(*) AS n FROM document_pages_fts WHERE document_pages_fts MATCH ?",
    )
    .get('"202273601"') as { n: number };
  db.close();
  expect(hits).toEqual([
    { title: "Решение № 714", page: 1 },
    { title: "Концесионен договор (PDF)", page: 2 },
  ]);
  expect(eik.n).toBe(1);
});

test("клаузите: договорът печели, съвпаденията и попълненията са отбелязани", () => {
  const db = new Database(dbPath, { readonly: true });
  const facts = db
    .prepare(
      `SELECT e.field, e.value_raw, e.page, e.rank, e.outcome, d.title
       FROM extracted_facts e JOIN documents d ON d.id = e.document_id
       WHERE e.concession_id = 'k:O-000123' ORDER BY e.field, e.rank`,
    )
    .all() as Array<Record<string, unknown>>;
  const c = db
    .prepare("SELECT * FROM concessions WHERE id = 'k:O-000123'")
    .get() as Record<string, unknown>;
  const review = db
    .prepare(
      "SELECT COUNT(*) AS n FROM review_queue WHERE reason = 'document_conflict'",
    )
    .get() as { n: number };
  db.close();

  const top = facts.filter((f) => f["rank"] === 1);
  expect(top.map((f) => [f["field"], f["outcome"], f["page"]])).toEqual([
    ["annual_payment", "agrees", 2],
    ["grace_period", "filled", 2],
    ["onetime_payment", "filled", 2],
    ["term", "agrees", 1],
    ["value", "agrees", 1],
  ]);
  expect(top.every((f) => f["title"] === "Концесионен договор (PDF)")).toBe(
    true,
  );
  // сканираното решение носи същите клаузи — пази се като алтернатива
  expect(
    facts.filter((f) => f["rank"] === 2).map((f) => [f["field"], f["outcome"]]),
  ).toEqual([
    ["annual_payment", "alternative"],
    ["grace_period", "alternative"],
    ["onetime_payment", "alternative"],
  ]);
  expect(c["onetime_payment_raw"]).toBe("1 500 лв.");
  expect(c["onetime_payment_eur"]).toBeCloseTo(1500 / 1.95583, 2);
  expect(c["grace_period_months"]).toBe(24);
  expect(c["annual_payment_flag"]).toBe("ok"); // регистърът не се пипа
  expect(review.n).toBe(0);
});

test("всички суми от документите, със страница и контекст", () => {
  const db = new Database(dbPath, { readonly: true });
  const amounts = db
    .prepare(
      `SELECT a.value_raw, a.page, a.value_eur FROM document_amounts a
       JOIN documents d ON d.id = a.document_id
       WHERE d.title = 'Концесионен договор (PDF)' ORDER BY a.page, a.id`,
    )
    .all();
  db.close();
  expect(amounts).toMatchObject([
    { value_raw: expect.stringContaining("82 080,98"), page: 1 },
    { value_raw: expect.stringContaining("508,03"), page: 2 },
    { value_raw: "1 500 лв.", page: 2 },
    { value_raw: "1 000 лв.", page: 2 },
  ]);
});
