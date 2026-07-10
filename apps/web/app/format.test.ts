import { expect, test } from "vitest";
import { fmtEur, fmtMonths, fmtPercent, toCsv } from "./format";

const nbsp = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

test("сумите са в български формат с €", () => {
  expect(nbsp(fmtEur(21457.56))).toBe("21 457,56 €");
  expect(fmtEur(null)).toBe("—");
});

test("сроковете показват и години при кръгли стойности", () => {
  expect(fmtMonths(420)).toBe("420 мес. (35 г.)");
  expect(fmtMonths(100)).toBe("100 мес.");
  expect(fmtMonths(null)).toBe("—");
});

test("процентите са с български десетичен знак", () => {
  expect(fmtPercent(0.0062)).toBe("0,62%");
});

test("CSV: UTF-8 BOM, екраниране на запетаи и кавички", () => {
  const csv = toCsv(
    ["a", "b"],
    [
      ["x,y", 'ка"вички'],
      [null, 5],
    ],
  );
  expect(csv.startsWith("﻿")).toBe(true);
  expect(csv).toContain('"x,y"');
  expect(csv).toContain('"ка""вички"');
  expect(csv.trim().split("\n")).toHaveLength(3);
});
