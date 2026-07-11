import {
  allRegNums,
  getSummary,
  listCompanies,
  listGrantors,
} from "../queries.server";

const BASE = "https://koncesii.com";
const STATIC = [
  "",
  "/concessions",
  "/grantors",
  "/companies",
  "/map",
  "/flags",
  "/search",
  "/methodology",
];

export function loader() {
  const lastmod = getSummary()?.data_date;
  const urls = [
    ...STATIC.map((p) => `${BASE}${p}`),
    ...allRegNums().map((r) => `${BASE}/concessions/${encodeURIComponent(r)}`),
    ...listGrantors().map(
      (g) => `${BASE}/grantors/${encodeURIComponent(g.slug)}`,
    ),
    // страница има само компания с ЕИК (/companies/:eik)
    ...listCompanies()
      .filter((c) => c.eik)
      .map((c) => `${BASE}/companies/${encodeURIComponent(c.eik!)}`),
  ];
  const entry = (u: string) =>
    `  <url><loc>${u}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`;
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map(entry).join("\n") +
    `\n</urlset>\n`;
  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
