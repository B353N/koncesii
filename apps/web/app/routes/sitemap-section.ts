import {
  SECTIONS,
  urlsFor,
  XML_HEADERS,
  type SitemapEntry,
} from "../sitemap.server";

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
