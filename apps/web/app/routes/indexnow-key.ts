/**
 * IndexNow ключ.
 *
 * IndexNow (Bing, Yandex, Seznam, Naver) приема известие „този адрес се
 * промени" и го обхожда в рамките на часове вместо седмици. Проверката е
 * файл на корена на домейна, чието име е самият ключ и чието съдържание
 * е пак ключът. Ключът е публичен по проектиране - не е тайна и затова
 * стои в кода, а не в env.
 *
 * Google няма такъв механизъм: ping endpoint-ът за sitemap е спрян през
 * 2023 г. За Google работи `lastmod` в sitemap-а (routes/sitemap-*.ts).
 *
 * Известията се пращат от `pnpm db:push` след успешна публикация.
 */
export const INDEXNOW_KEY = "5ce6c3405a4f93fd10b9128f208b2052";

export function loader() {
  return new Response(INDEXNOW_KEY + "\n", {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
