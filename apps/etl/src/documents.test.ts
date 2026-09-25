import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { extractDocFacts } from "ingest";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createDatabase } from "./db";
import { applyFacts } from "./documents";

let db: Database.Database;
const path = join(tmpdir(), `koncesii-documents-test-${process.pid}.sqlite`);

beforeEach(() => {
  db = createDatabase(path);
  db.prepare(
    `INSERT INTO concessions (id, reg_num, title, annual_payment_raw, annual_payment_eur,
       annual_payment_flag, source, source_url, fetched_at)
     VALUES ('k:X-1', 'X-1', 'Плаж', '100 лв.', 51.13, 'ok', 'nkr', 'https://nkr/x', '2026-07-08')`,
  ).run();
  db.prepare(
    "INSERT INTO documents (id, concession_id, title, kind, url) VALUES (1, 'k:X-1', 'Договор', 'file', 'https://nkr/doc')",
  ).run();
});

afterEach(() => {
  db.close();
  rmSync(path, { force: true });
});

const candidates = (text: string) =>
  new Map([
    [
      "k:X-1",
      extractDocFacts([text]).map((f) => ({
        ...f,
        documentId: 1,
        documentUrl: "https://nkr/doc",
        docRank: 0,
      })),
    ],
  ]);

test("разминаване с регистъра: стойността остава, флагът става contradictory + review_queue", () => {
  const r = applyFacts(
    db,
    candidates(
      "Годишното концесионно възнаграждение е 200 лв. Срокът на концесията е 10 години.",
    ),
    "2026-07-08",
  );
  expect(r).toMatchObject({ conflicts: 1, filled: 1 });

  const c = db
    .prepare("SELECT * FROM concessions WHERE id = 'k:X-1'")
    .get() as Record<string, unknown>;
  expect(c["annual_payment_raw"]).toBe("100 лв."); // регистърът печели
  expect(c["annual_payment_eur"]).toBe(51.13);
  expect(c["annual_payment_flag"]).toBe("contradictory");
  expect(c["term_months"]).toBe(120); // липсващото се попълва
  expect(c["term_flag"]).toBe("parsed_from_text");

  const review = db
    .prepare("SELECT reason, payload FROM review_queue")
    .all() as Array<{ reason: string; payload: string }>;
  expect(review).toHaveLength(1);
  expect(review[0]!.reason).toBe("document_conflict");
  expect(JSON.parse(review[0]!.payload)).toMatchObject({
    field: "annual_payment",
    registry: { raw: "100 лв.", value: 51.13 },
    document: { url: "https://nkr/doc", page: 1, value_raw: "200 лв." },
  });
});

test("срок без удълженията при по-дълъг регистър е съвместим, не разминаване", () => {
  db.prepare(
    "UPDATE concessions SET term_raw = '240 месеца', term_months = 240, term_flag = 'ok' WHERE id = 'k:X-1'",
  ).run();
  const r = applyFacts(
    db,
    candidates(
      "Срок на концесията: 1) Срок на концесията, без предвидените удължавания: 180 месеца 2) Предвидени в концесионния договор удължавания на срока на концесията: ☒ Да.",
    ),
    "2026-07-08",
  );
  expect(r.conflicts).toBe(0);
  const c = db
    .prepare(
      "SELECT term_months, term_flag FROM concessions WHERE id = 'k:X-1'",
    )
    .get();
  expect(c).toEqual({ term_months: 240, term_flag: "ok" });
  const f = db
    .prepare("SELECT outcome FROM extracted_facts WHERE field = 'term'")
    .get();
  expect(f).toEqual({ outcome: "compatible" });
  // по-кратък регистър остава разминаване
  db.prepare(
    "UPDATE concessions SET term_months = 120 WHERE id = 'k:X-1'",
  ).run();
  db.prepare("DELETE FROM extracted_facts").run();
  expect(
    applyFacts(
      db,
      candidates(
        "Срок на концесията, без предвидените удължавания: 180 месеца.",
      ),
      "2026-07-08",
    ).conflicts,
  ).toBe(1);
});

test("превалутирането на същата сума не е разминаване", () => {
  const r = applyFacts(
    db,
    candidates("Годишното концесионно възнаграждение е 51,13 евро."),
    "2026-07-08",
  );
  expect(r).toMatchObject({ agrees: 1, conflicts: 0 });
});

test("сумата с ДДС в договора съвпада с регистъра без ДДС", () => {
  // регистър: 51,13 € (без ДДС) = 100 лв.; договор: 120 лв. с ДДС
  const r = applyFacts(
    db,
    candidates(
      "Годишното концесионно възнаграждение е 120 лв. (сто и двадесет лева) с ДДС.",
    ),
    "2026-07-08",
  );
  expect(r).toMatchObject({ agrees: 1, conflicts: 0 });
});

test("процентът от приходите се пази за показване, не попълва колона", () => {
  applyFacts(
    db,
    candidates(
      "Годишното концесионно възнаграждение е 4 % от нетните приходи.",
    ),
    "2026-07-08",
  );
  const f = db
    .prepare("SELECT field, percent, outcome FROM extracted_facts")
    .get();
  expect(f).toEqual({
    field: "payment_percent",
    percent: 4,
    outcome: "display",
  });
});

test("nkrMoney: сумата от формуляра на НКР е в евро въпреки „лв.“", async () => {
  const { nkrMoney } = await import("./unify");
  // реален случай: 1 027,70 „лв." в регистъра = 2 010 лв. в договора
  expect(nkrMoney("Да Размер (BGN без ДДС): 1 027,70 лв.")).toMatchObject({
    raw: "Да Размер (BGN без ДДС): 1 027,70 лв.",
    currency: "EUR",
    eur: 1027.7,
  });
  expect(nkrMoney("500 евро")).toMatchObject({ currency: "EUR", eur: 500 });
  expect(nkrMoney("Няма въведени данни")).toMatchObject({ flag: "missing" });
});
