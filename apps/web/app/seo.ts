/**
 * SEO помощници: заглавие на страница, canonical адреси и пагинация.
 * Чисти функции без достъп до базата - тестват се в seo.test.ts.
 */

export const SITE = "https://koncesii.com";
export const SITE_NAME = "КОНЦЕСИИ";

/** "<нещо> | КОНЦЕСИИ" - един суфикс за целия сайт. */
export function pageTitle(text: string): string {
  return `${text} | ${SITE_NAME}`;
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
