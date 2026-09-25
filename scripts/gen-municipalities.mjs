// Генерира apps/web/app/municipalities.ts от газетира на ETL-а
// (apps/etl/assets/bg-gazetteer.json, GeoNames CC BY 4.0): общините с
// областта и центроида им. Сайтът не чете 400 KB газетир при старт.
//
//   node scripts/gen-municipalities.mjs
import { readFileSync, writeFileSync } from "node:fs";

const OBLASTS = {
  38: "Благоевград",
  39: "Бургас",
  40: "Добрич",
  41: "Габрово",
  42: "София (столица)",
  43: "Хасково",
  44: "Кърджали",
  45: "Кюстендил",
  46: "Ловеч",
  47: "Монтана",
  48: "Пазарджик",
  49: "Перник",
  50: "Плевен",
  51: "Пловдив",
  52: "Разград",
  53: "Русе",
  54: "Шумен",
  55: "Силистра",
  56: "Сливен",
  57: "Смолян",
  58: "София",
  59: "Стара Загора",
  60: "Търговище",
  61: "Варна",
  62: "Велико Търново",
  63: "Видин",
  64: "Враца",
  65: "Ямбол",
};
// Грешки в GeoNames, проверени на ръка: Симитли е само в Благоевград.
const FIX = { симитли: ["38"] };

const g = JSON.parse(
  readFileSync(
    new URL("../apps/etl/assets/bg-gazetteer.json", import.meta.url),
  ),
);
const out = {};
for (const [name, entries] of Object.entries(g.municipalities).sort()) {
  const codes = FIX[name] ?? [...new Set(entries.map((e) => e[2]))];
  out[name] = codes.map((code) => {
    const e = entries.find((x) => x[2] === code) ?? entries[0];
    return [OBLASTS[code] ?? code, +e[0].toFixed(4), +e[1].toFixed(4)];
  });
}
const body = `// ГЕНЕРИРАН ФАЙЛ - scripts/gen-municipalities.mjs, не се редактира на ръка.
// Източник: GeoNames (geonames.org), CC BY 4.0, през apps/etl/assets/bg-gazetteer.json.

/** Община (малки букви) → [област, lat, lon] за всяка община с това име. */
export const MUNICIPALITIES: Record<string, Array<[string, number, number]>> =
  ${JSON.stringify(out)};
`;
writeFileSync(
  new URL("../apps/web/app/municipalities.ts", import.meta.url),
  body,
);
console.log(`${Object.keys(out).length} общини`);
