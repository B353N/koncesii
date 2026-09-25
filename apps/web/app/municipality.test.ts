import { expect, test } from "vitest";
import {
  isPlaceholderName,
  municipalitySlug,
  resolveMunicipality,
  settlementsIn,
  withoutEgn,
} from "./municipality";

test("общината на обекта е с предимство", () => {
  expect(
    resolveMunicipality({
      objectMunicipality: "Созопол",
      grantorName: "Министерски съвет",
      texts: ["Концесия за морски плаж, община Созопол"],
    }),
  ).toMatchObject({ key: "созопол|Бургас", source: "object" });
});

test("общинският концедент дава общината", () => {
  expect(
    resolveMunicipality({
      grantorName: "Кмет на община Добрич-град",
      texts: [],
    }),
  ).toMatchObject({ key: "добрич|Добрич", source: "grantor" });
  expect(
    resolveMunicipality({
      grantorName: "Общински съвет Долна баня",
      texts: [],
    }),
  ).toMatchObject({ key: "долна баня|София", source: "grantor" });
});

test("община от текста, и с две думи", () => {
  expect(
    resolveMunicipality({
      grantorName: "Министерски съвет",
      texts: [
        'Концесия за добив от находище "Старо Оряхово", област Варна, община Долни чифлик',
      ],
    }),
  ).toMatchObject({ key: "долни чифлик|Варна", source: "text" });
});

test("непознато име или двусмислена община без област не се приема", () => {
  expect(
    resolveMunicipality({
      grantorName: "Министерски съвет",
      texts: ["община Атлантида"],
    }),
  ).toBeNull();
  expect(
    resolveMunicipality({ grantorName: "Кмет на община Бяла", texts: [] }),
  ).toBeNull();
  expect(
    resolveMunicipality({
      grantorName: "Кмет на община Бяла",
      texts: ["язовир в землището на с. Пейчиново, обл. Русе"],
    }),
  ).toMatchObject({ key: "бяла|Русе" });
});

test("адресът на двусмислена община носи областта", () => {
  expect(municipalitySlug("созопол", "Бургас")).toBe("sozopol");
  expect(municipalitySlug("долни чифлик", "Варна")).toBe("dolni-chiflik");
  expect(municipalitySlug("бяла", "Варна")).toBe("byala-varna");
});

test("назованите населени места", () => {
  expect(
    settlementsIn([
      "язовир в с. Михалково, община Девин; гр. Долна баня и село Две Могили",
    ]),
  ).toEqual(["Михалково", "Долна баня", "Две Могили"]);
});

test("регистровият шум не е концесионер, ЕГН не се показва", () => {
  expect(isPlaceholderName("Не е приложимо")).toBe(true);
  expect(isPlaceholderName("х")).toBe(true);
  expect(isPlaceholderName("„МАТ“ ООД")).toBe(false);
  expect(withoutEgn("Иван Петров Иванов с ЕГН 1234567890")).toBe(
    "Иван Петров Иванов",
  );
  expect(
    settlementsIn(["в землището на с. Шкорпиловци Концесия за добив"]),
  ).toEqual(["Шкорпиловци"]);
});
