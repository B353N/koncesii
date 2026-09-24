import { expect, test } from "vitest";
import { bgStem, documentKey, ftsQuery } from "./queries.server";

test("ftsQuery: всяка дума е префикс в кавички, синтаксисът на FTS5 е неутрализиран", () => {
  expect(ftsQuery("язовир Мътница")).toBe('"язовир"* "мътниц"*');
  expect(ftsQuery('срок" OR NEAR(x) *')).toBe('"срок"* "or"* "near"* "x"*');
  expect(ftsQuery("2 300,81")).toBe('"2"* "300"* "81"*');
  expect(ftsQuery("  „“ -- ")).toBeNull();
});

test("documentKey: GUID-ът на НКР, иначе стабилен хеш на адреса", () => {
  expect(
    documentKey(
      "https://nkr.government.bg/File/Download/AA11BB22-CC33-4D44-9E55-FF6677889900",
    ),
  ).toBe("aa11bb22-cc33-4d44-9e55-ff6677889900");
  // същото правило като file_id в tools/harvest/nkr_scraper.py
  expect(
    documentKey("https://nkr.government.bg/Content/Download/reshenie-714.pdf"),
  ).toBe("87d87d5242a72672116a");
});

test("bgStem: основата покрива членуваните и множествените форми", () => {
  expect(bgStem("гратисен")).toBe("гратис");
  expect("гратисният".startsWith(bgStem("гратисен"))).toBe(true);
  for (const form of ["година", "години", "годината"]) {
    expect(form.startsWith(bgStem("години"))).toBe(true);
  }
  expect(bgStem("възнаграждение")).toBe("възнаграждени");
  expect(bgStem("язовира")).toBe("язовир");
  expect(bgStem("срок")).toBe("срок"); // късите думи не се режат
  expect(bgStem("202273601")).toBe("202273601");
});
