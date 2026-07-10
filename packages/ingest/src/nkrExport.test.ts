import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { parseNkrExport } from "./nkrExport";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");
const bytes = readFileSync(join(FIXTURES, "export_concessions.win1251.tsv"));

test("декодира windows-1251 и разделя по табулация", () => {
  const { headers, rows } = parseNkrExport(new Uint8Array(bytes));
  expect(headers[0]).toBe("Номер на партида");
  expect(headers).toHaveLength(8);
  expect(rows).toHaveLength(3);
  expect(rows[0]).toMatchObject({
    "Номер на партида": "O-000123",
    Концедент: "Община Смолян",
    ЕИК: "123456789",
    "Срок (месеци)": "420",
  });
});

test("празните клетки стават null, кирилицата оцелява", () => {
  const { rows } = parseNkrExport(new Uint8Array(bytes));
  expect(rows[2]).toMatchObject({
    Концесионер: "Няма въведени данни",
    ЕИК: null,
    "Срок (месеци)": null,
  });
  expect(rows[0]?.["Наименование на концесията"]).toBe("Язовир „Мътница“");
});
