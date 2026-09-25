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
  return `/koncesii/${encodeURIComponent(slug)}`;
}

/**
 * Обтекаема система за транслитерация (Закон за транслитерацията, 2009):
 * „щ" → sht, „ъ" → a, „ия" в края на дума → ia. Така пишат българите
 * в търсачката на латиница и така изглеждат и адресите на държавата.
 */
const TRANSLIT: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sht",
  ъ: "a",
  ь: "y",
  ю: "yu",
  я: "ya",
};

export function translit(text: string): string {
  return text
    .toLowerCase()
    .replace(/ия(?=[^\p{L}]|$)/gu, "ia")
    .replace(/[а-я]/g, (c) => TRANSLIT[c] ?? c);
}

/** Латински адресен сегмент: малки букви, цифри и тирета, до max знака. */
export function slugify(text: string, max = 80): string {
  const s = translit(text.normalize("NFC"))
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (s.length <= max) return s;
  const cut = s.slice(0, max + 1);
  const dash = cut.lastIndexOf("-");
  return (dash > max / 2 ? cut.slice(0, dash) : s.slice(0, max)).replace(
    /-+$/,
    "",
  );
}

/** Синтетичен номер от общински ресурс: uuid#ред. */
const SYNTHETIC_RE = /^([0-9a-f]{8})[0-9a-f-]{22,}#(.+)$/i;

export interface UrlIndex {
  /** Каноничният slug на партида (винаги дефиниран за познат номер). */
  slugOf(regNum: string): string;
  /**
   * Партидата зад сегмента от адреса. `canonical` е false, когато адресът
   * е стар или с остаряла описателна част - тогава страницата прави 301.
   */
  resolve(segment: string): { regNum: string; canonical: boolean } | null;
  /** Всички канонични slug-ове в сортиран ред на номерата (за sitemap). */
  slugs(): string[];
}

/**
 * Адресът на партида: описателна част + номерът на партидата накрая
 * („morski-plazh-panorama-sever-varna-215-135-12-11-2021"). Номерът прави
 * адреса уникален и стабилен: ако регистърът смени заглавието, старият
 * адрес пак се разпознава по номера и прави 301 към новия.
 * `text` е описанието за адреса (виж concessionUrlText в queries).
 */
export function buildUrlIndex(
  rows: ReadonlyArray<{ reg_num: string; text: string }>,
): UrlIndex {
  const legacy = buildSlugIndex(rows.map((r) => r.reg_num));
  const sorted = [...rows].sort((a, b) =>
    a.reg_num < b.reg_num ? -1 : a.reg_num > b.reg_num ? 1 : 0,
  );
  const tokenOf = new Map<string, string>();
  const regOfToken = new Map<string, string>();
  for (const { reg_num } of sorted) {
    if (tokenOf.has(reg_num)) continue;
    const syn = SYNTHETIC_RE.exec(reg_num);
    const base =
      (syn ? slugify(`${syn[1]}-${syn[2]}`, 24) : "") ||
      slugify(legacy.slugOf(reg_num)) ||
      "partida";
    let t = base;
    for (let n = 2; regOfToken.has(t); n++) t = `${base}-${n}`;
    tokenOf.set(reg_num, t);
    regOfToken.set(t, reg_num);
  }
  const slugOf = new Map<string, string>();
  const regOfSlug = new Map<string, string>();
  for (const { reg_num, text } of sorted) {
    if (slugOf.has(reg_num)) continue;
    const token = tokenOf.get(reg_num)!;
    const head = slugify(text, 70);
    const slug = head ? `${head}-${token}` : token;
    slugOf.set(reg_num, slug);
    regOfSlug.set(slug, reg_num);
  }
  return {
    slugOf: (reg) => slugOf.get(reg) ?? slugify(regNumSlug(reg)),
    resolve(segment) {
      const exact = regOfSlug.get(segment);
      if (exact) return { regNum: exact, canonical: true };
      // остаряла описателна част: номерът е краят на адреса
      const lower = segment.toLowerCase();
      for (let i = 0; i < lower.length; i++) {
        if (i > 0 && lower[i - 1] !== "-") continue;
        const reg = regOfToken.get(lower.slice(i));
        if (reg) return { regNum: reg, canonical: false };
      }
      // адресите отпреди 16.09.2026 (slug само от номера)
      const old = legacy.regNumOf(segment);
      return old ? { regNum: old, canonical: false } : null;
    },
    slugs: () => sorted.map((r) => slugOf.get(r.reg_num)!),
  };
}

/** Път на раздел по вид обект; ключът в базата остава английски. */
export const KIND_SLUGS: Record<string, string> = {
  dam: "yazoviri",
  beach: "morski-plazhove",
  mining: "podzemni-bogatstva",
  quarry: "karieri",
  mineral_water: "mineralni-vodi",
  port: "pristanishta",
  infrastructure: "infrastruktura",
  property: "imoti",
  service: "uslugi",
  other: "drugi",
};
const KIND_OF_SLUG = new Map(
  Object.entries(KIND_SLUGS).map(([k, s]) => [s, k] as const),
);
/** Видът зад сегмента: новият slug или старият английски ключ. */
export function kindOfSlug(
  segment: string,
): { kind: string; canonical: boolean } | null {
  const k = KIND_OF_SLUG.get(segment);
  if (k) return { kind: k, canonical: true };
  return segment in KIND_SLUGS ? { kind: segment, canonical: false } : null;
}

/** Slug на компания: името на латиница и ЕИК накрая (ключът). */
export function companySlug(name: string, eik: string): string {
  const head = slugify(name, 60);
  return head ? `${head}-${eik}` : eik;
}
/** ЕИК-ът от края на адреса на компания (9 или 13 цифри). */
export function eikOfSlug(segment: string): string | null {
  const m = /(?:^|-)(\d{13}|\d{9})$/.exec(segment);
  return m ? m[1]! : null;
}
