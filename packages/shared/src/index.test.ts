import { expect, test } from "vitest";
import { BGN_PER_EUR, isValidEik, OBJECT_KINDS, VALUE_FLAGS } from "./index";

test("ЕИК is valid only as 9 or 13 digits", () => {
  expect(isValidEik("123456789")).toBe(true);
  expect(isValidEik("1234567890123")).toBe(true);
  expect(isValidEik("12345678")).toBe(false);
  expect(isValidEik("1234567890")).toBe(false);
  expect(isValidEik("12345678a")).toBe(false);
  expect(isValidEik("")).toBe(false);
});

test("domain constants match docs/core-scope.md", () => {
  expect(BGN_PER_EUR).toBe(1.95583);
  expect(VALUE_FLAGS).toHaveLength(4);
  expect(OBJECT_KINDS).toHaveLength(10);
});
