import { expect, test } from "vitest";
import { buildSlugIndex, concessionHref, regNumSlug } from "./slug";

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
  expect(concessionHref("О-000821")).toBe("/concessions/%D0%9E-000821");
  expect(concessionHref("221-72-07.10.2020")).toBe(
    "/concessions/221-72-07.10.2020",
  );
});
