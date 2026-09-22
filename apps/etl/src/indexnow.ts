import Database from "better-sqlite3";

/**
 * Известяване на търсачките след публикуване на нова база.
 *
 * IndexNow (Bing, Yandex, Seznam, Naver) приема списък с променени
 * адреси и ги обхожда за часове. Google няма такъв механизъм - ping
 * endpoint-ът за sitemap е спрян през 2023 г.; там работи `lastmod` в
 * sitemap-а, който идва от същата колона `changed_at`.
 *
 * Известието е „моля, обходи пак тези адреси", не публикуване на данни:
 * изпращат се само публични URL от koncesii.com.
 */

const ENDPOINT = "https://api.indexnow.org/indexnow";
const HOST = "koncesii.com";
const BASE = `https://${HOST}`;
/** IndexNow приема до 10 000 адреса в едно известие. */
const MAX_URLS = 10_000;

/** Същият slug както в сайта (apps/web/app/slug.ts). */
function regNumSlug(regNum: string): string {
  return regNum
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}.]+/gu, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
}

/**
 * Адресите, променени на датата на снапшота, плюс страниците, които се
 * менят с всяко обновяване. Празен списък → няма какво да се известява.
 */
export function changedUrls(dbPath: string, date: string): string[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    const has =
      (db
        .prepare<[], { n: number }>(
          "SELECT COUNT(*) AS n FROM pragma_table_info('concessions') WHERE name = 'changed_at'",
        )
        .get()?.n ?? 0) > 0;
    if (!has) return [];
    const rows = db
      .prepare<[string], { reg_num: string }>(
        "SELECT reg_num FROM concessions WHERE changed_at = ? ORDER BY reg_num",
      )
      .all(date);
    if (rows.length === 0) return [];

    // при колизия на slug сайтът дава суфикс -2; известяваме базовия
    // адрес, а сайтът прави 301 - IndexNow приема пренасочвания
    const urls = rows.map(
      (r) => `${BASE}/concessions/${regNumSlug(r.reg_num)}`,
    );
    return [
      `${BASE}/`,
      `${BASE}/changes`,
      `${BASE}/concessions`,
      ...new Set(urls),
    ].slice(0, MAX_URLS);
  } finally {
    db.close();
  }
}

export interface PingResult {
  sent: number;
  status: number | null;
  error?: string;
}

/** Изпраща известието; мрежова грешка не бива да проваля публикацията. */
export async function pingIndexNow(
  urlList: string[],
  key: string,
): Promise<PingResult> {
  if (urlList.length === 0) return { sent: 0, status: null };
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host: HOST,
        key,
        keyLocation: `${BASE}/${key}.txt`,
        urlList,
      }),
    });
    return { sent: urlList.length, status: res.status };
  } catch (err) {
    return {
      sent: 0,
      status: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
