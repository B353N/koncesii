import { expect, test } from "vitest";
import { BGN_PER_EUR } from "shared";
import { eurFrom, parseDecimal, parseMoney } from "./money";

test("чиста стойност с валута е ok", () => {
  const p = parseMoney("41 967,34 лв.");
  expect(p).toMatchObject({ value: 41967.34, currency: "BGN", flag: "ok" });
  expect(p.eur).toBeCloseTo(41967.34 / BGN_PER_EUR, 2);
});

test("двата десетични формата дават едно и също число", () => {
  expect(parseDecimal("1 234,56")).toBe(1234.56);
  expect(parseDecimal("1,234.56")).toBe(1234.56);
});

test("евро се приема по номинал", () => {
  const p = parseMoney("1,234.56 EUR");
  expect(p).toMatchObject({
    value: 1234.56,
    currency: "EUR",
    eur: 1234.56,
    flag: "ok",
  });
});

test("число в свободен текст е parsed_from_text, оригиналът се пази", () => {
  const p = parseMoney("2 300,81 лв. годишно, дължимо на две равни вноски");
  expect(p.value).toBe(2300.81);
  expect(p.flag).toBe("parsed_from_text");
  expect(p.raw).toBe("2 300,81 лв. годишно, дължимо на две равни вноски");
});

test("число без валута подразбира BGN, но не е ok", () => {
  const p = parseMoney("4500");
  expect(p).toMatchObject({
    value: 4500,
    currency: "BGN",
    flag: "parsed_from_text",
  });
  expect(p.eur).toBeCloseTo(4500 / BGN_PER_EUR, 2);
});

test("„Няма въведени данни“ е missing, не нула", () => {
  const p = parseMoney("Няма въведени данни");
  expect(p).toMatchObject({ value: null, eur: null, flag: "missing" });
  expect(p.raw).toBe("Няма въведени данни");
});

test("празно и нечислово е missing", () => {
  expect(parseMoney("").flag).toBe("missing");
  expect(parseMoney(null).flag).toBe("missing");
  expect(parseMoney("по договаряне").flag).toBe("missing");
});

test("eurFrom ползва фиксирания курс", () => {
  expect(eurFrom(195.583, "BGN")).toBe(100);
  expect(eurFrom(100, "EUR")).toBe(100);
});

test("сума преди „Няма въведени данни“ се парсва; след нея — не", () => {
  const p = parseMoney(
    "Да Размер (BGN без ДДС): 685,13 лв.или Няма въведени данни Срок за плащане: 5500 дни",
  );
  expect(p.value).toBe(685.13);
  expect(p.flag).toBe("parsed_from_text");
  expect(parseMoney("Няма въведени данни Срок за плащане: 5500 дни").flag).toBe(
    "missing",
  );
});
