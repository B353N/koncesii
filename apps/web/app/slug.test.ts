import { expect, test } from "vitest";
import {
  buildSlugIndex,
  buildUrlIndex,
  companySlug,
  concessionHref,
  eikOfSlug,
  kindOfSlug,
  regNumSlug,
  slugify,
  translit,
} from "./slug";

test("slug-ът заменя /, #, интервали и ; с тире, но пази точки и кирилица", () => {
  expect(regNumSlug("221-72/07.10.2020")).toBe("221-72-07.10.2020");
  expect(regNumSlug("0288880a-df5a-44de-9e30-f0a2e9de1802#1")).toBe(
    "0288880a-df5a-44de-9e30-f0a2e9de1802-1",
  );
  expect(regNumSlug("О - 000821")).toBe("О-000821");
  expect(regNumSlug("d6535d57#13.")).toBe("d6535d57-13");
  expect(regNumSlug("uuid#Не е приложимо")).toBe("uuid-Не-е-приложимо");
  expect(regNumSlug("O-001040")).toBe("O-001040");
});

test("колизиите са детерминистични: чистият номер печели, другите получават суфикс", () => {
  const idx = buildSlugIndex([
    "D-000377",
    "D - 000377",
    "O-000700",
    "D-000377",
  ]);
  expect(idx.slugOf("D-000377")).toBe("D-000377");
  expect(idx.slugOf("D - 000377")).toBe("D-000377-2");
  expect(idx.regNumOf("D-000377")).toBe("D-000377");
  expect(idx.regNumOf("D-000377-2")).toBe("D - 000377");
  expect(idx.regNumOf("няма")).toBeNull();
  expect(idx.slugs()).toEqual(["D-000377-2", "D-000377", "O-000700"]);
});

test("всеки номер се връща обратно от своя slug", () => {
  const regs = ["A - 1", "A-1", "A-1-2", "x/y#z", "x-y-z"];
  const idx = buildSlugIndex(regs);
  for (const r of regs) expect(idx.regNumOf(idx.slugOf(r))).toBe(r);
});

test("href кодира кирилицата, но остава един сегмент", () => {
  expect(concessionHref("o-000821")).toBe("/koncesii/o-000821");
  expect(concessionHref("morski-plazh-215-135-12-11-2021")).toBe(
    "/koncesii/morski-plazh-215-135-12-11-2021",
  );
});

test("транслитерацията следва обтекаемата система", () => {
  expect(translit("Щастливеца")).toBe("shtastlivetsa");
  expect(translit("България")).toBe("balgaria");
  expect(translit("Кърджали, София")).toBe("kardzhali, sofia");
  expect(translit("Юг и ясен")).toBe("yug i yasen");
});

test("slugify прави латински сегмент и реже на граница на дума", () => {
  expect(slugify("Морски плаж „Панорама - север“, Варна")).toBe(
    "morski-plazh-panorama-sever-varna",
  );
  expect(slugify("Находище „Кайметлий“, пясъци и чакъли", 30)).toBe(
    "nahodishte-kaymetliy-pyasatsi",
  );
  expect(slugify("О - 000821")).toBe("o-000821");
});

const ROWS = [
  {
    reg_num: "215-135/12.11.2021",
    text: "Морски плаж „Панорама - север“ Варна",
  },
  { reg_num: "О - 000821", text: "Язовир „Рибарник“" },
  {
    reg_num: "d6535d57-baa1-4e55-a3e7-c6da4ff24945#14",
    text: "Услуга Костенец",
  },
  { reg_num: "221-72/07.10.2020", text: "" },
];

test("адресът на партида е описание + номер и се разпознава обратно", () => {
  const idx = buildUrlIndex(ROWS);
  expect(idx.slugOf("215-135/12.11.2021")).toBe(
    "morski-plazh-panorama-sever-varna-215-135-12-11-2021",
  );
  expect(idx.slugOf("О - 000821")).toBe("yazovir-ribarnik-o-000821");
  expect(idx.slugOf("d6535d57-baa1-4e55-a3e7-c6da4ff24945#14")).toBe(
    "usluga-kostenets-d6535d57-14",
  );
  expect(idx.slugOf("221-72/07.10.2020")).toBe("221-72-07-10-2020");
  for (const r of ROWS)
    expect(idx.resolve(idx.slugOf(r.reg_num))).toEqual({
      regNum: r.reg_num,
      canonical: true,
    });
});

test("стари и остарели адреси водят до партидата, но не са канонични", () => {
  const idx = buildUrlIndex(ROWS);
  // адресът отпреди: slug само от номера
  expect(idx.resolve("215-135-12.11.2021")).toEqual({
    regNum: "215-135/12.11.2021",
    canonical: false,
  });
  expect(idx.resolve("О-000821")).toEqual({
    regNum: "О - 000821",
    canonical: false,
  });
  // регистърът е сменил заглавието: номерът в края решава
  expect(idx.resolve("staro-zaglavie-215-135-12-11-2021")).toEqual({
    regNum: "215-135/12.11.2021",
    canonical: false,
  });
  expect(idx.resolve("nyama-takava")).toBeNull();
});

test("видовете и компаниите имат латински адреси", () => {
  expect(kindOfSlug("morski-plazhove")).toEqual({
    kind: "beach",
    canonical: true,
  });
  expect(kindOfSlug("beach")).toEqual({ kind: "beach", canonical: false });
  expect(kindOfSlug("nyama")).toBeNull();
  expect(companySlug("Блек Сий Бийч ЕООД", "204567891")).toBe(
    "blek-siy-biych-eood-204567891",
  );
  expect(eikOfSlug("blek-siy-biych-eood-204567891")).toBe("204567891");
  expect(eikOfSlug("204567891")).toBe("204567891");
  expect(eikOfSlug("firma-12345")).toBeNull();
});
