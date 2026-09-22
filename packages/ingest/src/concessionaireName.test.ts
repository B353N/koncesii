import { expect, test } from "vitest";
import { cleanConcessionaireName } from "./concessionaireName";

test("маха БУЛСТАТ заедно със свързващото „с“", () => {
  expect(cleanConcessionaireName('"МАРИЯ-М-65" ЕООД с БУЛСТАТ 201207954')).toBe(
    '"МАРИЯ-М-65" ЕООД',
  );
});

test("маха ЕИК след запетая", () => {
  expect(cleanConcessionaireName("„Гьошев ИН“ ЕООД, ЕИК 202273601")).toBe(
    "„Гьошев ИН“ ЕООД",
  );
});

test("маха „със ЕИК“ и 13-цифрен БУЛСТАТ", () => {
  expect(cleanConcessionaireName("ЕТ „АПОЛО“ със ЕИК 1234567890123")).toBe(
    "ЕТ „АПОЛО“",
  );
});

test("маха идентификатор в скоби", () => {
  expect(cleanConcessionaireName('"РЕЛА" ЕООД (ЕИК: 123456789)')).toBe(
    '"РЕЛА" ЕООД',
  );
});

test("не пипа име без идентификатор", () => {
  expect(cleanConcessionaireName('"ХОЛСИМ КАРИЕРНИ МАТЕРИАЛИ" АД')).toBe(
    '"ХОЛСИМ КАРИЕРНИ МАТЕРИАЛИ" АД',
  );
});

test("не яде „с“, което е част от името", () => {
  expect(cleanConcessionaireName("Рибовъдство с. Ясен ООД")).toBe(
    "Рибовъдство с. Ясен ООД",
  );
  expect(cleanConcessionaireName("„Строй и Сие“ ООД")).toBe(
    "„Строй и Сие“ ООД",
  );
});

test("празната стойност остава празна", () => {
  expect(cleanConcessionaireName(null)).toBe("");
  expect(cleanConcessionaireName("  ")).toBe("");
});

test("нормализира интервалите като normText", () => {
  expect(cleanConcessionaireName('  "БДС"   ЕООД  с ЕИК 123456789 ')).toBe(
    '"БДС" ЕООД',
  );
});
