#!/usr/bin/env node
// Проверка на SEO хигиената върху публикуваната база: всяка страница
// трябва да има уникално, информативно заглавие и собствено описание.
// Пуска се срещу работещ сайт (по подразбиране локалния preview):
//
//   node scripts/check-seo.mjs [--base http://localhost:3178] [--sample 120]
//
// Обхожда sitemap-ите, тегли извадка от адресите и проверява:
//   * <title> съществува, не е родово и не се повтаря на други страници
//   * <meta name="description"> съществува и е уникално
//   * <link rel="canonical"> сочи към самата страница
//   * страницата има JSON-LD
// Изходен код 1 при намерен проблем - CI спира.

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  const v = i !== -1 ? process.argv[i + 1] : undefined;
  return v && !v.startsWith("--") ? v : fallback;
};

const BASE = arg("--base", "http://localhost:3178").replace(/\/$/, "");
const SAMPLE = Number(arg("--sample", "120"));
const SITE = "https://koncesii.com";
const MIN_TITLE = 18;
const MAX_TITLE = 140;
const MIN_DESC = 60;

const GENERIC = new Set([
  "услуга",
  "услуги",
  "строителство",
  "концесия",
  "концесия за услуги",
  "особено право на ползване",
]);

const pick = (re, html) => {
  const m = re.exec(html);
  return m ? m[1].trim() : null;
};

const decode = (s) =>
  s
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");

async function sitemapUrls() {
  const index = await (await fetch(`${BASE}/sitemap.xml`)).text();
  const maps = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const urls = [];
  for (const map of maps) {
    const xml = await (
      await fetch(map.replace(SITE, BASE).replace(/\/$/, ""))
    ).text();
    urls.push(...[...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
  }
  return urls;
}

/** Равномерна извадка - хваща и началото, и края на всяка секция. */
function sample(urls, n) {
  if (urls.length <= n) return urls;
  const step = urls.length / n;
  return Array.from({ length: n }, (_, i) => urls[Math.floor(i * step)]);
}

const problems = [];
const titles = new Map();
const descs = new Map();

const urls = await sitemapUrls();
if (urls.length === 0) {
  console.error("✗ sitemap-ите са празни - сайтът работи ли на " + BASE + "?");
  process.exit(1);
}

for (const url of sample(urls, SAMPLE)) {
  const local = url.replace(SITE, BASE);
  const res = await fetch(local, { redirect: "manual" });
  if (res.status !== 200) {
    problems.push(`${url}: HTTP ${res.status} (в sitemap, а не е 200)`);
    continue;
  }
  const html = await res.text();
  const rawTitle = pick(/<title>([^<]*)<\/title>/i, html);
  const title = rawTitle
    ? decode(rawTitle).replace(/\s*\|\s*КОНЦЕСИИ$/, "")
    : null;
  const desc = pick(/<meta name="description" content="([^"]*)"/i, html);
  const canonical = pick(/<link rel="canonical" href="([^"]*)"/i, html);

  if (!title) problems.push(`${url}: липсва <title>`);
  else {
    if (title.length < MIN_TITLE)
      problems.push(`${url}: заглавие под ${MIN_TITLE} знака ("${title}")`);
    if (title.length > MAX_TITLE)
      problems.push(
        `${url}: заглавие над ${MAX_TITLE} знака (${title.length})`,
      );
    if (GENERIC.has(title.toLowerCase()))
      problems.push(`${url}: родово заглавие ("${title}")`);
    const seen = titles.get(title);
    if (seen) problems.push(`${url}: същото заглавие като ${seen}`);
    else titles.set(title, url);
  }

  if (!desc) problems.push(`${url}: липсва meta description`);
  else {
    if (decode(desc).length < MIN_DESC)
      problems.push(`${url}: описание под ${MIN_DESC} знака`);
    const seen = descs.get(desc);
    if (seen) problems.push(`${url}: същото описание като ${seen}`);
    else descs.set(desc, url);
  }

  if (!canonical) problems.push(`${url}: липсва canonical`);
  else if (canonical.replace(/\/$/, "") !== url.replace(/\/$/, ""))
    problems.push(`${url}: canonical сочи към ${canonical}`);

  if (!html.includes('type="application/ld+json"'))
    problems.push(`${url}: липсва JSON-LD`);
}

const checked = Math.min(urls.length, SAMPLE);
if (problems.length) {
  console.error(
    `✗ SEO проверка: ${problems.length} проблема в ${checked} страници\n`,
  );
  for (const p of problems.slice(0, 40)) console.error(`  - ${p}`);
  if (problems.length > 40) console.error(`  … и още ${problems.length - 40}`);
  process.exit(1);
}
console.log(
  `✓ SEO проверка: ${checked} страници от ${urls.length} в sitemap - уникални заглавия и описания, коректен canonical, налично JSON-LD`,
);
