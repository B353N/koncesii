import { expect, test } from "vitest";
import { extractEik } from "./eik";

test("вади 9-цифрен ЕИК от свободен текст", () => {
  expect(extractEik("„Рибовъдство Родопи“ ЕООД, ЕИК 123456789")).toBe(
    "123456789",
  );
});

test("вади 13-цифрен ЕИК цял, не първите 9 цифри", () => {
  expect(extractEik("БУЛСТАТ 1234567890123 — клон")).toBe("1234567890123");
});

test("не приема 10 цифри, телефонни номера и празно", () => {
  expect(extractEik("тел. 0301 62 000")).toBeNull();
  expect(extractEik("ЕИК 1234567890")).toBeNull();
  expect(extractEik("")).toBeNull();
});
