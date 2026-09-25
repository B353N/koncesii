/**
 * SEO помощници: заглавие на страница, canonical адреси и пагинация.
 * Чисти функции без достъп до базата - тестват се в seo.test.ts.
 */
import { shortObjectTitle } from "./format";
import { translit } from "./slug";

export const SITE = "https://koncesii.com";
export const SITE_NAME = "КОНЦЕСИИ";

/** "<нещо> | КОНЦЕСИИ" - един суфикс за целия сайт. */
export function pageTitle(text: string): string {
  return `${text} | ${SITE_NAME}`;
}

/**
 * Един адрес на страница: без наклонена черта накрая и с малки латински
 * букви (/Koncesii/ → /koncesii). Кирилицата не се пипа - тя е само в
 * старите адреси, които имат собствени 301 (routes/legacy-redirect.ts).
 */
export function normalizePath(pathname: string): string {
  const p = pathname.replace(/\/+$/, "") || "/";
  return p.replace(/[A-Z]+/g, (m) => m.toLowerCase());
}

/** Абсолютен адрес на страница по път (без домейн). */
export function absUrl(path: string): string {
  return `${SITE}${path}`;
}

/** Пълен адрес на страница N от пагиниран списък: страница 1 е чистият път. */
export function pagedUrl(basePath: string, page: number): string {
  return absUrl(page > 1 ? `${basePath}?page=${page}` : basePath);
}

export interface PagedMeta {
  canonical: string;
  prev: string | null;
  next: string | null;
  /** "страница 2 от 32" или null на първата страница. */
  pageLabel: string | null;
}

/** canonical + rel=prev/next за пагиниран списък. */
export function pagedMeta(
  basePath: string,
  page: number,
  pages: number,
): PagedMeta {
  const safePage = Math.min(Math.max(1, page), Math.max(1, pages));
  return {
    canonical: pagedUrl(basePath, safePage),
    prev: safePage > 1 ? pagedUrl(basePath, safePage - 1) : null,
    next: safePage < pages ? pagedUrl(basePath, safePage + 1) : null,
    pageLabel: safePage > 1 ? `страница ${safePage} от ${pages}` : null,
  };
}

/** Meta descriptor-ите за canonical, prev и next (React Router meta()). */
export function pagedLinkDescriptors(m: PagedMeta) {
  const out: Array<{ tagName: "link"; rel: string; href: string }> = [
    { tagName: "link", rel: "canonical", href: m.canonical },
  ];
  if (m.prev) out.push({ tagName: "link", rel: "prev", href: m.prev });
  if (m.next) out.push({ tagName: "link", rel: "next", href: m.next });
  return out;
}

/**
 * Заглавията идват както са в регистъра: 33 партиди имат под 15 знака
 * ("услуга", "3"), 142 носят целия текст на решението (над 200 знака), а
 * 23 заглавия се повтарят на 84 страници. Суровата стойност остава
 * видима на страницата ("Предмет по регистъра"); за title и h1 я
 * допълваме детерминистично с факти, които вече са в базата - вид,
 * концедент, номер на партида. Нищо не се измисля.
 */

/** Родови заглавия, които не различават партидата от съседната. */
const GENERIC_TITLES = new Set([
  "услуга",
  "услуги",
  "строителство",
  "строителство и управление",
  "концесия за услуги",
  "концесия за услуга",
  "концесия за строителство",
  "особено право на ползване",
  "концесия",
  "друго",
]);

const MIN_DISTINCT = 25;
const MAX_TITLE = 135;

/** Разделители, на които дългото регистрово заглавие се реже смислено. */
const CUT_RE =
  /(,\s*(област|община|разположено|находящ|описан)|\s+[–—-]\s+|;|\s\(|\s+съгласно\s+|\s+описан[оа]?\s+)/iu;

/**
 * Родово е заглавие, което не различава партидата: точна дума от списъка,
 * само число или няколко знака. Късото, но конкретно заглавие („Рибарник
 * Невски") се запазва - то се различава по концедент и номер.
 */
export function isGenericTitle(title: string): boolean {
  const t = title
    .trim()
    .replace(/[.„“"'']/gu, "")
    .toLowerCase();
  // \W брои кирилицата за не-дума, затова проверката е по буква
  return (
    GENERIC_TITLES.has(t) || /^[^\p{L}]*\d+[^\p{L}]*$/u.test(t) || t.length < 6
  );
}

/** Реже дълго заглавие на най-близкия разделител след 60-ия знак. */
export function shortenTitle(title: string, max = MAX_TITLE): string {
  const t = title.trim().replace(/\s+/gu, " ");
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const m = CUT_RE.exec(head.slice(60));
  if (m && m.index != null) return head.slice(0, 60 + m.index).trim();
  const space = head.lastIndexOf(" ");
  return (space > 60 ? head.slice(0, space) : head).trim() + "…";
}

/** Синтетичен номер от общински ресурс (uuid#ред) не се чете като номер. */
const SYNTHETIC_REG_RE = /^([0-9a-f]{8})[0-9a-f-]{22,}#(\d+|.+)$/i;

/**
 * Как се нарича партидата в заглавие: четимо и достатъчно за разлика.
 * Синтетичните номера пазят началото на идентификатора на ресурса -
 * иначе ред №4 от два различни общински регистъра дава едно заглавие.
 */
export function regLabel(regNum: string): string {
  const m = SYNTHETIC_REG_RE.exec(regNum);
  return m ? `общински регистър ${m[1]}/${m[2]}` : regNum;
}

/** Име, което всъщност е URL или адрес-простиня, не влиза в заглавие. */
function usableName(name: string | null | undefined): string | null {
  const t = name?.trim();
  if (!t || /^https?:\/\//i.test(t) || t.includes("://")) return null;
  return t;
}

/** Заглавие на страница за компания/концедент: името се реже, не се маха. */
export function entityTitle(name: string, suffix: string, max = 120): string {
  return `${shortenTitle(name.trim(), max)} ${suffix}`.trim();
}

/** Изречение от наличните факти; липсващите просто отпадат. */
export function sentence(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(" ").replace(/\s+/gu, " ").trim();
}

/** Описание (meta description) - до ~300 знака, без измислени стойности. */
export function clampDescription(text: string, max = 300): string {
  const t = text.replace(/\s+/gu, " ").trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const cut = head.lastIndexOf(" ");
  return (cut > 0 ? head.slice(0, cut) : head) + "…";
}

/** og:title/description/url за страница - същите текстове като в <title>. */
export function ogDescriptors(o: {
  title: string;
  description: string;
  url: string;
  type?: string;
}) {
  return [
    { property: "og:title", content: o.title },
    { property: "og:description", content: o.description },
    { property: "og:url", content: o.url },
    ...(o.type ? [{ property: "og:type", content: o.type }] : []),
  ];
}

export interface HeadlineParts {
  title: string | null;
  /** Вид на обекта: „Морски плаж", „Язовир" … */
  kindLabel?: string | null;
  /** „за услуги", „за строителство" - видът на самата концесия. */
  concessionKindLabel?: string | null;
  /** Описанието на първия обект, ако заглавието е родово. */
  objectDescription?: string | null;
  grantorName?: string | null;
  municipality?: string | null;
}

/**
 * Какво е обектът, накратко: „Морски плаж „Панорама - север"",
 * „Находище „Кайметлий", пясъци и чакъли", или регистровото заглавие,
 * отрязано на смислен разделител. Родовите заглавия („услуга") се
 * заменят с вида на концесията и описанието на обекта. Нищо не се измисля.
 */
function headlineLabel(p: HeadlineParts): string {
  const raw = (p.title ?? "").trim().replace(/\s+/gu, " ");
  if (raw && !isGenericTitle(raw)) {
    const short = shortObjectTitle(raw);
    return /^(Находище|Морски плаж) /u.test(short)
      ? short
      : shortenTitle(raw, 80);
  }
  const obj = usableName(
    p.objectDescription &&
      p.objectDescription.trim().toLowerCase() !== raw.toLowerCase()
      ? p.objectDescription
      : null,
  );
  const what = obj
    ? shortenTitle(shortObjectTitle(obj), 60)
    : (p.kindLabel?.toLowerCase() ?? null);
  const head = ["Концесия", p.concessionKindLabel].filter(Boolean).join(" ");
  return what ? `${head}: ${what}` : head;
}

/** Мястото: общината на обекта, иначе общината от името на концедента. */
function headlinePlace(p: HeadlineParts): string | null {
  const m = p.municipality?.trim();
  if (m) return m;
  const g = usableName(p.grantorName);
  const fromGrantor = g && /община\s+(.+)$/iu.exec(g);
  return fromGrantor ? fromGrantor[1]!.trim() : null;
}

/**
 * H1 и основата на <title> на партида: обектът и общината
 * („Морски плаж „Панорама - север", община Варна"). Думите, които хората
 * търсят, са отпред; номерът на партидата не е тук (виж concessionPageTitle).
 */
export function concessionHeadline(p: HeadlineParts): string {
  const label = headlineLabel(p);
  const place = headlinePlace(p);
  if (!place || translit(label).includes(translit(place))) return label;
  return `${label}, община ${place}`;
}

/**
 * <title> на партида: заглавието + „концесия", ако думата я няма. Когато
 * две партиди биха имали едно и също заглавие (4 еднакви „Концесия за
 * строителство на автобусни спирки" във Варна), номерът ги различава.
 */
export function concessionPageTitle(
  headline: string,
  regNum: string,
  duplicate: boolean,
): string {
  const tail = `${/концеси/iu.test(headline) ? "" : " - концесия"}${
    duplicate ? ` (партида ${regLabel(regNum)})` : ""
  }`;
  // целият <title> с „ | КОНЦЕСИИ" остава под ~110 знака
  return shortenTitle(headline, Math.max(60, 98 - tail.length)) + tail;
}

/**
 * Описателната част на адреса на партида: същият етикет като заглавието и
 * общината („Морски плаж „Панорама - север" Варна"); slugify го прави на
 * латиница.
 */
export function concessionUrlText(p: HeadlineParts): string {
  const label = headlineLabel(p);
  const place = headlinePlace(p);
  if (place && !translit(label).includes(translit(place)))
    return `${label} ${place}`;
  return label;
}
