import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import {
  extractGrantor,
  extractRows,
  mapHeaders,
  normalizeResource,
} from "./egov";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");
const payload = JSON.parse(
  readFileSync(join(FIXTURES, "egov_resource.json"), "utf8"),
) as unknown;

const DATASET = {
  uri: "obshtina-smolyan-koncesii",
  name: "Регистър на концесиите — Община Смолян",
  source: "Община Смолян",
  updated_at: "2026-05-14",
};

test("extractRows намира таблицата независимо от влагането", () => {
  const rows = extractRows(payload);
  expect(rows).toHaveLength(5);
  expect(rows[1]?.[0]).toBe("№ по ред");
});

test("mapHeaders: първото съвпадение печели, неразпознатите се докладват", () => {
  const { mapping, unmapped } = mapHeaders([
    "№ по ред",
    "Решение на ОбС",
    "Предмет на концесията",
    "Концесионер",
    "ЕИК/БУЛСТАТ",
    "Срок на договора",
    "Годишно концесионно възнаграждение",
    "Забележка",
  ]);
  expect([...mapping.values()]).toEqual([
    "row_number",
    "decision",
    "subject",
    "concessionaire",
    "eik",
    "term",
    "payment",
  ]);
  expect(unmapped).toEqual(["Забележка"]);
});

test("normalizeResource: пълен запис с произход и парснато възнаграждение", () => {
  const { records, unmapped } = normalizeResource(payload, DATASET, "res-001");
  expect(records).toHaveLength(2);
  expect(unmapped).toEqual(["Забележка"]);
  expect(records[0]).toMatchObject({
    source: "data.egov.bg",
    dataset_uri: "obshtina-smolyan-koncesii",
    resource_uri: "res-001",
    grantor: "Община Смолян",
    subject: "язовир „Мътница“, с. Могилица",
    eik: "123456789",
    term: "35 години",
    payment_value: 259.75,
    payment_currency: "BGN",
    payment_flag: "ok",
  });
});

test("ЕИК се извлича от текста на концесионера, когато колоната е празна", () => {
  const { records } = normalizeResource(payload, DATASET, "res-001");
  expect(records[1]).toMatchObject({
    concessionaire: "„Пътища Родопи“ АД, ЕИК 831652485",
    eik: "831652485",
    payment_value: 2300.81,
    payment_flag: "parsed_from_text",
  });
});

test("празните редове преди хедъра и в края се прескачат", () => {
  const { records } = normalizeResource(payload, DATASET, "res-001");
  expect(records.every((r) => r["row_number"])).toBe(true);
});

test("концедентът се извлича от името на набора, не е името на регистъра", () => {
  expect(extractGrantor("", "Регистър на концесиите в Община Костенец")).toBe(
    "Община Костенец",
  );
  expect(
    extractGrantor(
      "",
      "РЕГИСТЪР НА КОНЦЕСИИТЕ НА ТЕРИТОРИЯТА НА ОБЩИНА БОЙЧИНОВЦИ",
    ),
  ).toBe("Община Бойчиновци");
  expect(extractGrantor("Община Драгоман", "Регистър на концесиите")).toBe(
    "Община Драгоман",
  );
  expect(extractGrantor("", "Регистър на концесиите 2023 година")).toBeNull();
});
