import { expect, test } from "vitest";
import { parseTerm } from "./term";

test("месеци и години се нормализират еднакво: 420", () => {
  expect(parseTerm("420 месеца")).toMatchObject({ months: 420, flag: "ok" });
  expect(parseTerm("35 години")).toMatchObject({ months: 420, flag: "ok" });
  expect(parseTerm("35 (тридесет и пет) години")).toMatchObject({
    months: 420,
    flag: "ok",
  });
});

test("съкратени единици", () => {
  expect(parseTerm("25 г.")).toMatchObject({ months: 300, flag: "ok" });
  expect(parseTerm("6 мес.")).toMatchObject({ months: 6, flag: "ok" });
});

test("голо число: под 100 е години, над 100 е месеци — винаги parsed_from_text", () => {
  expect(parseTerm("35")).toMatchObject({
    months: 420,
    flag: "parsed_from_text",
  });
  expect(parseTerm("300")).toMatchObject({
    months: 300,
    flag: "parsed_from_text",
  });
});

test("срок в изречение е parsed_from_text", () => {
  expect(
    parseTerm("Срокът на концесията е 20 години от датата на договора"),
  ).toMatchObject({
    months: 240,
    flag: "parsed_from_text",
  });
});

test("липса на данни е missing", () => {
  expect(parseTerm("Няма въведени данни")).toMatchObject({
    months: null,
    flag: "missing",
  });
  expect(parseTerm("")).toMatchObject({ months: null, flag: "missing" });
});
