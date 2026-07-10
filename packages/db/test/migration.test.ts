import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, test } from "vitest";

const MIGRATION = join(
  dirname(fileURLToPath(import.meta.url)),
  "../migrations/0000_init.sql",
);

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(readFileSync(MIGRATION, "utf8"));
});

afterEach(() => db.close());

const tables = () =>
  db
    .prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((r) => r.name);

test("creates the staging, domain and derived tables from docs/core-scope.md", () => {
  expect(tables()).toEqual([
    "concessionaires",
    "concessions",
    "documents",
    "flags",
    "grantors",
    "objects",
    "payments",
    "procedures",
    "raw_egov_rows",
    "raw_nkr_announcements",
    "raw_nkr_export",
    "raw_old_concessions",
    "review_queue",
    "rollups",
  ]);
});

test("accepts a full row round-trip with prefixed ids", () => {
  db.prepare(
    "INSERT INTO grantors (id, name, normalized_name, kind) VALUES ('gr:obshtina-smolyan', 'Община Смолян', 'obshtina smolyan', 'municipality')",
  ).run();
  db.prepare(
    "INSERT INTO concessionaires (id, eik, name, normalized_name) VALUES ('eik:123456789', '123456789', 'Фирма ЕООД', 'firma eood')",
  ).run();
  db.prepare(
    `INSERT INTO concessions (id, reg_num, title, kind, grantor_id, concessionaire_id,
       term_raw, term_months, term_flag, value_raw, value_eur, value_flag,
       source, source_url, fetched_at)
     VALUES ('k:O-000123', 'O-000123', 'язовир „Тест"', 'construction',
       'gr:obshtina-smolyan', 'eik:123456789',
       '420 месеца', 420, 'ok', '41 967,34 лв.', 21457.78, 'parsed_from_text',
       'nkr', 'https://nkr.government.bg/x', '2026-07-10')`,
  ).run();
  const row = db
    .prepare<[], { term_months: number; value_raw: string }>(
      "SELECT term_months, value_raw FROM concessions WHERE id = 'k:O-000123'",
    )
    .get();
  expect(row).toEqual({ term_months: 420, value_raw: "41 967,34 лв." });
});

test("rejects a value_flag outside the documented set", () => {
  expect(() =>
    db
      .prepare(
        `INSERT INTO concessions (id, reg_num, title, value_flag, source, source_url, fetched_at)
         VALUES ('k:X', 'X', 't', 'guessed', 'nkr', 'https://x', '2026-07-10')`,
      )
      .run(),
  ).toThrow(/CHECK/);
});

test("rejects an unknown object kind (taxonomy is closed)", () => {
  db.prepare(
    `INSERT INTO concessions (id, reg_num, title, source, source_url, fetched_at)
     VALUES ('k:Y', 'Y', 't', 'nkr', 'https://x', '2026-07-10')`,
  ).run();
  expect(() =>
    db
      .prepare(
        "INSERT INTO objects (id, concession_id, seq, description, kind) VALUES ('obj:k:Y:1', 'k:Y', 1, 'd', 'castle')",
      )
      .run(),
  ).toThrow(/CHECK/);
});

test("enforces provenance: source_url is NOT NULL", () => {
  expect(() =>
    db
      .prepare(
        `INSERT INTO concessions (id, reg_num, title, source, fetched_at)
         VALUES ('k:Z', 'Z', 't', 'nkr', '2026-07-10')`,
      )
      .run(),
  ).toThrow(/NOT NULL/);
});
