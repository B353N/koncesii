import {
  allRegNums,
  getSummary,
  listCompanies,
  listGrantors,
} from "../queries.server";

export const BASE = "https://koncesii.com";
export const SECTIONS = [
  "pages",
  "concessions",
  "grantors",
  "companies",
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
const PAGES = [
  "",
  "/concessions",
  "/grantors",
  "/companies",
  "/map",
  "/flags",
  "/methodology",
];

function urlsFor(section: Section): string[] {
  switch (section) {
    case "pages":
      return PAGES.map((p) => `${BASE}${p}`);
    case "concessions":
      return allRegNums().map(
        (r) => `${BASE}/concessions/${encodeURIComponent(r)}`,
      );
    case "grantors":
      return listGrantors().map(
        (g) => `${BASE}/grantors/${encodeURIComponent(g.slug)}`,
      );
    case "companies":
      // страница има само компания с ЕИК (/companies/:eik)
      return listCompanies()
        .filter((c) => c.eik)
        .map((c) => `${BASE}/companies/${encodeURIComponent(c.eik!)}`);
  }
}

/**
 * Resource route: /sitemap-<section>.xml — urlset за една секция.
 * Една и съща route файл е закачен на четири пътя (виж routes.ts);
 * секцията се чете от pathname.
 */
export function loader({ request }: { request: Request }) {
  const m = /\/sitemap-([a-z]+)\.xml$/.exec(new URL(request.url).pathname);
  const section = SECTIONS.find((s) => s === m?.[1]);
  if (!section) return new Response("Not found", { status: 404 });

  const lastmod = getSummary()?.data_date;
  const entry = (u: string) =>
    `  <url><loc>${u}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`;
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urlsFor(section).map(entry).join("\n") +
    `\n</urlset>\n`;
  return new Response(xml, { headers: XML_HEADERS });
}
