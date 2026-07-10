import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { parsePreview, splitNumbered } from "./nkrAnnouncement";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");
const html = readFileSync(join(FIXTURES, "assigned_concession.html"), "utf8");

test("секциите се ключират по римския номер на Раздела", () => {
  const { sections } = parsePreview(html);
  expect(Object.keys(sections)).toEqual([
    "I Концедент",
    "VI Концесионер",
    "IX Основни параметри",
  ]);
});

test("номерираните подточки се разбиват на label → value", () => {
  const { sections } = parsePreview(html);
  expect(sections["IX Основни параметри"]?.items).toMatchObject({
    "9.6.1 Годишно концесионно възнаграждение": "259,75 лв.",
    "9.12.1 Срок на концесията": "420 месеца",
    "9.12.2 Стойност на концесията": "41 967,34 лв.",
  });
});

test("„Няма въведени данни“ в подточка става стойност, не изчезва", () => {
  const { sections } = parsePreview(html);
  expect(
    sections["IX Основни параметри"]?.items?.[
      "9.6.2 Еднократно концесионно възнаграждение"
    ],
  ).toBe("Няма въведени данни");
});

test("секция без номерация пази form-group стойностите", () => {
  const { sections } = parsePreview(html);
  expect(sections["VI Концесионер"]?.groups).toEqual([
    "„Рибовъдство Родопи“ ЕООД",
    "ЕИК 123456789",
    "гр. Смолян, ул. „Родопи“ 14",
  ]);
});

test("script/nav/header/footer не замърсяват текста", () => {
  const { sections } = parsePreview(html);
  const all = JSON.stringify(sections);
  expect(all).not.toContain("telemetry");
  expect(all).not.toContain("Национален концесионен регистър");
});

test("splitNumbered работи и върху плосък текст без DOM", () => {
  expect(
    splitNumbered("9.1. Срок: 25 години 9.2. Начална дата: 01.03.2020"),
  ).toEqual({
    "9.1 Срок": "25 години",
    "9.2 Начална дата": "01.03.2020",
  });
});
