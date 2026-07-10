import { allRegNums } from "../queries.server";

const BASE = "https://koncesii.com";
const STATIC = [
  "",
  "/concessions",
  "/grantors",
  "/companies",
  "/flags",
  "/search",
  "/methodology",
];

export function loader() {
  const urls = [
    ...STATIC.map((p) => `${BASE}${p}`),
    ...allRegNums().map((r) => `${BASE}/concessions/${encodeURIComponent(r)}`),
  ];
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n") +
    `\n</urlset>\n`;
  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
