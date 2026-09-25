import { getSummary } from "../queries.server";
import { BASE, SECTIONS, sectionSize, XML_HEADERS } from "./sitemap-section";

/**
 * Resource route: /sitemap.xml — sitemap index, който сочи към по една
 * карта на секция (/sitemap-<section>.xml). Разделянето дава на Search
 * Console видимост „открити / индексирани" по тип страница и позволява
 * Google да препрочита само променената секция.
 */
export function loader() {
  const lastmod = getSummary()?.data_date;
  const entry = (s: string) =>
    `  <sitemap><loc>${BASE}/sitemap-${s}.xml</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</sitemap>`;
  // празна секция (напр. документите, докато няма извлечен текст) не влиза
  // в индекса - Search Console я отчита като грешка, не като „0 страници"
  const sections = SECTIONS.filter((s) => sectionSize(s) > 0);
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    sections.map(entry).join("\n") +
    `\n</sitemapindex>\n`;
  return new Response(xml, { headers: XML_HEADERS });
}
