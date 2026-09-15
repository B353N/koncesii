/**
 * URL slug на партида.
 *
 * Партидните номера от регистрите съдържат "/", "#", интервали и ";"
 * (напр. "221-72/07.10.2020", "<uuid>#14", "О - 000821"). Кодирани като
 * %2F / %23 / %20 те се нормализират различно от търсачките: Search
 * Console чете "#" като фрагмент, а "/" като нов сегмент, и адресът става
 * 404. Slug-ът заменя всичко извън букви, цифри и точка с "-".
 *
 * Суровият номер никога не се променя - той остава ключът в базата, в
 * JSON изгледа и в CSV (правилото „не поправяме стойности от регистъра").
 * Slug-ът е само адрес: старите адреси със суров номер правят 301.
 */
export function regNumSlug(regNum: string): string {
  return regNum
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}.]+/gu, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
}

export interface SlugIndex {
  /** Slug за суров партиден номер (винаги дефиниран). */
  slugOf(regNum: string): string;
  /** Суров номер за slug; null ако няма такъв. */
  regNumOf(slug: string): string | null;
  /** Всички slug-ове в сортиран ред на номерата (за sitemap). */
  slugs(): string[];
}

/**
 * Съответствие номер ↔ slug за цялата база. При колизия (напр.
 * "D - 000377" и "D-000377" дават един slug) печели номерът, чийто slug
 * е самият той; останалите получават суфикс -2, -3 … в сортиран ред.
 * Детерминистично за дадена база - едни и същи данни дават едни и същи
 * адреси.
 */
export function buildSlugIndex(regNums: readonly string[]): SlugIndex {
  const toSlug = new Map<string, string>();
  const toReg = new Map<string, string>();
  const sorted = [...new Set(regNums)].sort();
  const claim = (reg: string, slug: string) => {
    toSlug.set(reg, slug);
    toReg.set(slug, reg);
  };
  for (const reg of sorted) {
    const s = regNumSlug(reg);
    if (s === reg && !toReg.has(s)) claim(reg, s);
  }
  for (const reg of sorted) {
    if (toSlug.has(reg)) continue;
    const base = regNumSlug(reg) || "partida";
    let s = base;
    for (let n = 2; toReg.has(s); n++) s = `${base}-${n}`;
    claim(reg, s);
  }
  return {
    slugOf: (reg) => toSlug.get(reg) ?? regNumSlug(reg),
    regNumOf: (slug) => toReg.get(slug) ?? null,
    slugs: () => sorted.map((r) => toSlug.get(r)!),
  };
}

/** Пътят на страницата на партида (без домейн). */
export function concessionHref(slug: string): string {
  return `/concessions/${encodeURIComponent(slug)}`;
}
