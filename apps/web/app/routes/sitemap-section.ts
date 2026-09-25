import {
  allConcessionSlugs,
  concessionLastmod,
  documentPagesForSitemap,
  getSummary,
  listCompanies,
  listGrantors,
  listMunicipalities,
} from "../queries.server";
import { POSTS } from "../blog/posts";
import { KIND_LABELS } from "../format";
import {
  blogHref,
  companyHref,
  concessionHref,
  documentHref,
  grantorHref,
  kindHref,
  municipalityHref,
  PATHS,
} from "../paths";

export const BASE = "https://koncesii.com";
export const SECTIONS = [
  "pages",
  "concessions",
  "grantors",
  "companies",
  "municipalities",
  "documents",
] as const;
export const XML_HEADERS = {
  "Content-Type": "application/xml; charset=utf-8",
  "Cache-Control": "public, max-age=3600",
};

type Section = (typeof SECTIONS)[number];

/**
 * Статичните страници. /search е с noindex и нарочно липсва — URL в
 * sitemap + noindex е противоречив сигнал за Google.
 */
/**
 * Страници, които се менят с всяко обновяване на данните. Извън списъка
 * остават статичните (методологията) - те се менят само с PR.
 */
const STATIC_PAGES = new Set<string>([PATHS.methodology]);

/** Анализите се менят само с PR; числата в тях - с данните. */

const PAGES = [
  "",
  PATHS.concessions,
  ...Object.keys(KIND_LABELS).map(kindHref),
  PATHS.grantors,
  PATHS.municipalities,
  PATHS.companies,
  PATHS.map,
  PATHS.flags,
  PATHS.changes,
  PATHS.blog,
  ...POSTS.map((post) => blogHref(post.slug)),
  PATHS.methodology,
];

interface SitemapEntry {
  loc: string;
  /** Дата на последна реална промяна; липсва, ако не я знаем. */
  lastmod?: string | undefined;
}

function urlsFor(section: Section): SitemapEntry[] {
  const dataDate = getSummary()?.data_date;
  switch (section) {
    case "pages":
      return PAGES.map((p) => ({
        loc: `${BASE}${p}`,
        // статичните страници не се менят с данните
        lastmod: STATIC_PAGES.has(p) ? undefined : dataDate,
      }));
    case "concessions": {
      // lastmod на партида = датата, в която съдържанието ѝ се е променило
      // (apps/etl/src/changes.ts). Еднаква дата на 2000 URL е шум.
      const lastmod = concessionLastmod();
      return allConcessionSlugs().map((s) => ({
        loc: `${BASE}${concessionHref(s)}`,
        lastmod: lastmod.get(s),
      }));
    }
    case "grantors":
      return listGrantors().map((g) => ({
        loc: `${BASE}${grantorHref(g.slug)}`,
        lastmod: dataDate,
      }));
    case "companies":
      // страница има само компания с ЕИК (/kompanii/<име>-<ЕИК>)
      return listCompanies()
        .filter((c) => c.eik)
        .map((c) => ({
          loc: `${BASE}${companyHref(c.name, c.eik!)}`,
          lastmod: dataDate,
        }));
    case "municipalities":
      return listMunicipalities().rows.map((m) => ({
        loc: `${BASE}${municipalityHref(m.slug)}`,
        lastmod: dataDate,
      }));
    case "documents":
      // текстът на договорите/решенията - lastmod е този на партидата
      return documentPagesForSitemap().map((d) => ({
        loc: `${BASE}${documentHref(d.slug, d.key)}`,
        lastmod: d.lastmod ?? undefined,
      }));
  }
}

/**
 * Resource route: /sitemap-<section>.xml — urlset за една секция.
 * Една и съща route файл е закачен на пет пътя (виж routes.ts);
 * секцията се чете от pathname.
 */
export function loader({ request }: { request: Request }) {
  const m = /\/sitemap-([a-z]+)\.xml$/.exec(new URL(request.url).pathname);
  const section = SECTIONS.find((s) => s === m?.[1]);
  if (!section) return new Response("Not found", { status: 404 });

  const entry = (e: SitemapEntry) =>
    `  <url><loc>${e.loc}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ""}</url>`;
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urlsFor(section).map(entry).join("\n") +
    `\n</urlset>\n`;
  return new Response(xml, { headers: XML_HEADERS });
}
