/**
 * Адресите на сайта - единственото място, което ги знае. Латиница по
 * обтекаемата система (slug.ts): така българите пишат на латиница и
 * адресът оцелява при копиране, за разлика от %D0%BA… на кирилица.
 * Старите английски адреси правят 301 към тези (routes/legacy-redirect.ts).
 */
import { companySlug, concessionHref, KIND_SLUGS, slugify } from "./slug";

export const PATHS = {
  home: "/",
  concessions: "/koncesii",
  concessionsCsv: "/koncesii.csv",
  grantors: "/koncedenti",
  grantorsCsv: "/koncedenti.csv",
  companies: "/kompanii",
  companiesCsv: "/kompanii.csv",
  flags: "/indikatori",
  flagsCsv: "/indikatori.csv",
  map: "/karta",
  mapGeojson: "/karta.geojson",
  mapPoints: "/karta-tochki.json",
  changes: "/promeni",
  blog: "/analizi",
  methodology: "/metodologiya",
  search: "/tarsene",
  municipalities: "/obshtini",
} as const;

export { concessionHref };

export function concessionJsonHref(slug: string): string {
  return `${concessionHref(slug)}/json`;
}

export function documentHref(slug: string, key: string): string {
  return `${concessionHref(slug)}/dokumenti/${encodeURIComponent(key)}`;
}

/** Страница по вид обект; ключът в базата (dam, beach …) остава английски. */
export function kindHref(kind: string): string {
  return `${PATHS.concessions}/vid/${KIND_SLUGS[kind] ?? encodeURIComponent(kind)}`;
}

/**
 * Концедент: id-то в базата е „gr:" + slug на кирилица; адресът е същият
 * slug на латиница (166 концедента, без колизии след транслитерация -
 * getGrantor пак проверява).
 */
export function grantorSlug(cyrillicSlug: string): string {
  return slugify(cyrillicSlug, 120);
}
export function grantorHref(cyrillicSlug: string): string {
  return `${PATHS.grantors}/${grantorSlug(cyrillicSlug)}`;
}

/** Компания: името на латиница + ЕИК. Без валиден ЕИК страница няма. */
export function companyHref(name: string, eik: string): string {
  return `${PATHS.companies}/${companySlug(name, eik)}`;
}

export function flagHref(code?: string | null): string {
  return code ? `${PATHS.flags}?code=${encodeURIComponent(code)}` : PATHS.flags;
}

export function blogHref(slug: string): string {
  return `${PATHS.blog}/${slug}`;
}

/** Концесиите в една община (/obshtini/sozopol). */
export function municipalityHref(slug: string): string {
  return `${PATHS.municipalities}/${slug}`;
}
