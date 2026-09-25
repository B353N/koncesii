import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "./db.server";
import {
  CONCESSION_KIND_LABELS,
  FACT_ORDER,
  KIND_LABELS,
  SEVERITY_RANK,
  shortObjectTitle,
} from "./format";
import { buildUrlIndex, type UrlIndex } from "./slug";
import {
  concessionHeadline,
  concessionPageTitle,
  concessionUrlText,
} from "./seo";
import { grantorSlug } from "./paths";

/**
 * Всички заявки на сайта. Строго read-only, само bound параметри —
 * никаква конкатенация на потребителски вход в SQL (docs/architecture.md).
 */

export interface Summary {
  data_date: string;
  concessions: number;
  grantors: number;
  concessionaires: number;
  flagged: number;
}

export interface ConcessionRow {
  reg_num: string;
  /** URL slug на партидата (виж slug.ts); адресът е /koncesii/<slug>. */
  slug: string;
  /** Краткото заглавие (h1 на партидата) - текстът на връзките. */
  headline: string;
  title: string;
  status: string | null;
  grantor_name: string | null;
  grantor_slug: string | null;
  concessionaire_name: string | null;
  eik: string | null;
  term_months: number | null;
  annual_payment_raw: string | null;
  annual_payment_eur: number | null;
  object_kind: string | null;
  flags: string | null; // "high,med" — тежести, разделени със запетая
}

export interface ListFilters {
  kind?: string | null;
  status?: string | null;
  grantor?: string | null;
  flagged?: boolean;
  q?: string | null;
  limit?: number;
  offset?: number;
}

const LIST_COLS = `c.reg_num, c.title, c.status,
         g.name AS grantor_name, substr(g.id, 4) AS grantor_slug,
         co.name AS concessionaire_name, co.eik,
         c.term_months, c.annual_payment_raw, c.annual_payment_eur,
         o.kind AS object_kind,
         (SELECT group_concat(f.severity) FROM flags f WHERE f.concession_id = c.id) AS flags`;
const LIST_FROM = `FROM concessions c
  LEFT JOIN grantors g ON g.id = c.grantor_id
  LEFT JOIN concessionaires co ON co.id = c.concessionaire_id
  LEFT JOIN objects o ON o.concession_id = c.id AND o.seq = 1`;
const LIST_SQL = `SELECT ${LIST_COLS} ${LIST_FROM}`;

/** Редовете от LIST_SQL без slug - той се добавя от withSlugs(). */
type ListRow = Omit<ConcessionRow, "slug">;

/**
 * Индексът номер ↔ адрес и заглавията на партидите се строят веднъж за
 * отворената база (WeakMap по handle: при атомарна подмяна на файла
 * getDb() връща нов handle и индексът се престроява). Адресът е
 * описание + номер (slug.ts); заглавието е обектът и общината (seo.ts).
 */
interface ConcessionIndex {
  urls: UrlIndex;
  headline: Map<string, string>;
  /** заглавия, които се падат на повече от една партида */
  duplicate: Set<string>;
}
const concessionIndexes = new WeakMap<Database.Database, ConcessionIndex>();
function concessionIndex(db: Database.Database): ConcessionIndex {
  let ci = concessionIndexes.get(db);
  if (ci) return ci;
  const rows = db
    .prepare<
      [],
      {
        reg_num: string;
        title: string | null;
        ckind: string | null;
        grantor: string | null;
        kind: string | null;
        description: string | null;
        municipality: string | null;
      }
    >(
      `SELECT c.reg_num, c.title, c.kind AS ckind, g.name AS grantor,
              (SELECT o.kind FROM objects o WHERE o.concession_id = c.id
                ORDER BY o.seq LIMIT 1) AS kind,
              (SELECT o.description FROM objects o WHERE o.concession_id = c.id
                ORDER BY o.seq LIMIT 1) AS description,
              (SELECT o.municipality FROM objects o WHERE o.concession_id = c.id
                AND o.municipality IS NOT NULL ORDER BY o.seq LIMIT 1) AS municipality
         FROM concessions c LEFT JOIN grantors g ON g.id = c.grantor_id`,
    )
    .all();
  const headline = new Map<string, string>();
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  const texts = rows.map((r) => {
    const parts = {
      title: r.title,
      kindLabel: r.kind ? (KIND_LABELS[r.kind] ?? null) : null,
      concessionKindLabel: r.ckind
        ? (CONCESSION_KIND_LABELS[r.ckind] ?? null)
        : null,
      objectDescription: r.description,
      grantorName: r.grantor,
      municipality: r.municipality,
    };
    const h = concessionHeadline(parts);
    headline.set(r.reg_num, h);
    if (seen.has(h)) duplicate.add(h);
    seen.add(h);
    return { reg_num: r.reg_num, text: concessionUrlText(parts) };
  });
  ci = { urls: buildUrlIndex(texts), headline, duplicate };
  concessionIndexes.set(db, ci);
  return ci;
}
function slugIndex(db: Database.Database): UrlIndex {
  return concessionIndex(db).urls;
}

/** H1 и <title> на партида (seo.ts), с номера само при дубликат. */
export function concessionTitles(
  regNum: string,
): { headline: string; pageTitle: string } | null {
  const db = getDb();
  if (!db) return null;
  const ci = concessionIndex(db);
  const headline = ci.headline.get(regNum);
  if (!headline) return null;
  return {
    headline,
    pageTitle: concessionPageTitle(
      headline,
      regNum,
      ci.duplicate.has(headline),
    ),
  };
}

/**
 * Адресът и краткото заглавие на всеки ред: връзките в списъците носят
 * същия текст като h1 на партидата (сигнал за търсачките и четим за
 * хората); регистровото заглавие остава в `title`.
 */
function withSlugs<T extends { reg_num: string }>(
  db: Database.Database,
  rows: T[],
): Array<T & { slug: string; headline: string }> {
  const ci = concessionIndex(db);
  return rows.map((r) => ({
    ...r,
    slug: ci.urls.slugOf(r.reg_num),
    headline:
      ci.headline.get(r.reg_num) ??
      ("title" in r && typeof r.title === "string" ? r.title : r.reg_num),
  }));
}

/** Slug за суров партиден номер. */
export function concessionSlug(regNum: string): string {
  const db = getDb();
  return db ? slugIndex(db).slugOf(regNum) : regNum;
}

/** Всички slug-ове (за sitemap), в сортиран ред на номерата. */
export function allConcessionSlugs(): string[] {
  const db = getDb();
  return db ? slugIndex(db).slugs() : [];
}

/**
 * Разпознава сегмента от /koncesii/<x> (и от старите /concessions/<x>):
 * каноничен адрес, остаряла описателна част, стар slug само от номера,
 * суров партиден номер или номер, отрязан на "#" от търсачка, ако е
 * еднозначен. `slug` е каноничният адрес - ако се различава от сегмента,
 * страницата прави 301. Връща null, ако няма такава партида.
 */
export function resolveConcession(
  param: string,
): { reg_num: string; slug: string } | null {
  const db = getDb();
  if (!db) return null;
  const idx = slugIndex(db);
  const hit = idx.resolve(param);
  if (hit) return { reg_num: hit.regNum, slug: idx.slugOf(hit.regNum) };
  const exists = db
    .prepare<[string], { reg_num: string }>(
      "SELECT reg_num FROM concessions WHERE reg_num = ?",
    )
    .get(param);
  if (exists) return { reg_num: param, slug: idx.slugOf(param) };
  const truncated = db
    .prepare<[string], { reg_num: string }>(
      "SELECT reg_num FROM concessions WHERE reg_num LIKE ? ESCAPE '\\' LIMIT 2",
    )
    .all(param.replace(/[\\%_]/g, (ch) => `\\${ch}`) + "#%");
  if (truncated.length === 1) {
    const reg = truncated[0]!.reg_num;
    return { reg_num: reg, slug: idx.slugOf(reg) };
  }
  return null;
}

export function getSummary(): Summary | null {
  const db = getDb();
  if (!db) return null;
  const row = db
    .prepare<[], { payload: string }>(
      "SELECT payload FROM rollups WHERE key = 'summary'",
    )
    .get();
  return row ? (JSON.parse(row.payload) as Summary) : null;
}

/**
 * Има ли базата колоните за свежест (content_hash / changed_at). Стара
 * база без тях не бива да чупи сайта - sitemap-ът просто остава без
 * lastmod, а „Промени" показва празно състояние.
 */
const freshnessSupport = new WeakMap<Database.Database, boolean>();
function hasFreshness(db: Database.Database): boolean {
  let ok = freshnessSupport.get(db);
  if (ok === undefined) {
    ok =
      (db
        .prepare<[], { n: number }>(
          "SELECT COUNT(*) AS n FROM pragma_table_info('concessions') WHERE name = 'changed_at'",
        )
        .get()?.n ?? 0) > 0;
    freshnessSupport.set(db, ok);
  }
  return ok;
}

/** Дата на последна реална промяна по партида (slug → YYYY-MM-DD). */
export function concessionLastmod(): Map<string, string> {
  const out = new Map<string, string>();
  const db = getDb();
  if (!db || !hasFreshness(db)) return out;
  const idx = slugIndex(db);
  for (const row of db
    .prepare<[], { reg_num: string; changed_at: string }>(
      "SELECT reg_num, changed_at FROM concessions WHERE changed_at IS NOT NULL",
    )
    .iterate()) {
    out.set(idx.slugOf(row.reg_num), row.changed_at);
  }
  return out;
}

export interface ChangedRow extends ConcessionRow {
  changed_at: string;
  /** true, когато партидата се появява за първи път в тази дата. */
  is_new: number;
}

/** Партидите, променени най-скоро - захранва страницата „Промени". */
export function recentlyChanged(limit = 60): ChangedRow[] {
  const db = getDb();
  if (!db || !hasFreshness(db)) return [];
  return withSlugs(
    db,
    db
      .prepare<[number], ListRow & { changed_at: string; is_new: number }>(
        `SELECT ${LIST_COLS}, c.changed_at,
                (c.changed_at = (SELECT MIN(changed_at) FROM concessions)) AS is_new
         ${LIST_FROM}
         WHERE c.changed_at IS NOT NULL
         ORDER BY c.changed_at DESC, c.reg_num
         LIMIT ?`,
      )
      .all(limit),
  );
}

/** Датите с промени и броят партиди за всяка - за „Промени" и lastmod. */
export function changeDates(): Array<{ changed_at: string; n: number }> {
  const db = getDb();
  if (!db || !hasFreshness(db)) return [];
  return db
    .prepare<[], { changed_at: string; n: number }>(
      `SELECT changed_at, COUNT(*) AS n FROM concessions
       WHERE changed_at IS NOT NULL GROUP BY changed_at ORDER BY changed_at DESC`,
    )
    .all();
}

export function listConcessions(f: ListFilters): {
  rows: ConcessionRow[];
  total: number;
} {
  const db = getDb();
  if (!db) return { rows: [], total: 0 };

  const where: string[] = [];
  const params: Record<string, string | number> = {};
  if (f.kind) {
    where.push("o.kind = @kind");
    params["kind"] = f.kind;
  }
  if (f.status) {
    where.push("c.status = @status");
    params["status"] = f.status;
  }
  if (f.grantor) {
    where.push("g.id = @grantor");
    params["grantor"] = `gr:${f.grantor}`;
  }
  if (f.flagged) {
    where.push("EXISTS (SELECT 1 FROM flags f WHERE f.concession_id = c.id)");
  }
  if (f.q) {
    where.push(
      "(c.title LIKE @q OR c.reg_num LIKE @q OR co.name LIKE @q OR g.name LIKE @q OR co.eik = @qexact)",
    );
    params["q"] = `%${f.q}%`;
    params["qexact"] = f.q;
  }
  const cond = where.length ? ` WHERE ${where.join(" AND ")}` : "";

  const total =
    db
      .prepare<[Record<string, string | number>], { n: number }>(
        `SELECT COUNT(*) AS n FROM (${LIST_SQL}${cond})`,
      )
      .get(params)?.n ?? 0;

  const rows = withSlugs(
    db,
    db
      .prepare<[Record<string, string | number>], ListRow>(
        `${LIST_SQL}${cond} ORDER BY c.reg_num LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit: f.limit ?? 50, offset: f.offset ?? 0 }),
  );

  return { rows, total };
}

export interface ConcessionFull {
  id: string;
  reg_num: string;
  title: string;
  kind: string | null;
  status: string | null;
  grantor_id: string | null;
  concessionaire_id: string | null;
  start_date: string | null;
  term_raw: string | null;
  term_months: number | null;
  term_flag: string;
  extensions_raw: string | null;
  value_raw: string | null;
  value_eur: number | null;
  value_flag: string;
  onetime_payment_raw: string | null;
  onetime_payment_eur: number | null;
  onetime_payment_flag: string;
  annual_payment_raw: string | null;
  annual_payment_eur: number | null;
  annual_payment_flag: string;
  grace_period_months: number | null;
  grace_period_raw: string | null;
  indexation_raw: string | null;
  has_indexation: number | null;
  source: string;
  source_url: string;
  announcement_url: string | null;
  fetched_at: string;
}

export interface ObjectRow {
  id: string;
  description: string;
  kind: string;
  kind_raw: string | null;
  oblast: string | null;
  municipality: string | null;
  place: string | null;
  lat: number | null;
  lon: number | null;
  /** 'settlement' | 'municipality' - точката е центроид, приблизителна */
  geo_precision: string | null;
}

export interface PaymentRow {
  contracted_raw: string | null;
  contracted_eur: number | null;
  source_url: string;
}

export interface ConcessionDetail {
  concession: ConcessionFull;
  /** URL slug на партидата; адресът е /koncesii/<slug>. */
  slug: string;
  grantor: { id: string; name: string } | null;
  concessionaire: { id: string; name: string; eik: string | null } | null;
  objects: ObjectRow[];
  documents: DocumentRow[];
  /** Клаузите, извлечени от документите (избраните + разминаванията). */
  facts: FactRow[];
  payments: PaymentRow[];
  flags: Array<{ code: string; severity: string; inputs: string }>;
}

export function getConcession(regNum: string): ConcessionDetail | null {
  const db = getDb();
  if (!db) return null;
  const concession = db
    .prepare<[string], ConcessionFull>(
      "SELECT * FROM concessions WHERE reg_num = ?",
    )
    .get(regNum);
  if (!concession) return null;
  const id = concession.id;

  const grantor = concession.grantor_id
    ? (db
        .prepare<[string], { id: string; name: string }>(
          "SELECT id, name FROM grantors WHERE id = ?",
        )
        .get(concession.grantor_id) ?? null)
    : null;
  const concessionaire = concession.concessionaire_id
    ? (db
        .prepare<[string], { id: string; name: string; eik: string | null }>(
          "SELECT id, name, eik FROM concessionaires WHERE id = ?",
        )
        .get(concession.concessionaire_id) ?? null)
    : null;

  return {
    concession,
    slug: slugIndex(db).slugOf(regNum),
    grantor,
    concessionaire,
    objects: db
      .prepare<[string], ObjectRow>(
        `SELECT id, description, kind, kind_raw, oblast, municipality, place,
                lat, lon, geo_precision
           FROM objects WHERE concession_id = ? ORDER BY seq`,
      )
      .all(id),
    documents: documentRows(db, id),
    facts: factRows(db, id),
    payments: db
      .prepare<[string], PaymentRow>(
        "SELECT contracted_raw, contracted_eur, source_url FROM payments WHERE concession_id = ? ORDER BY id",
      )
      .all(id),
    flags: db
      .prepare<[string], { code: string; severity: string; inputs: string }>(
        "SELECT code, severity, inputs FROM flags WHERE concession_id = ? ORDER BY severity, code",
      )
      .all(id),
  };
}

export interface GrantorRow {
  slug: string;
  name: string;
  kind: string;
  concessions: number;
  flagged: number;
}

export function listGrantors(): GrantorRow[] {
  const db = getDb();
  if (!db) return [];
  return db
    .prepare<[], GrantorRow>(
      `SELECT substr(g.id, 4) AS slug, g.name, g.kind,
              COUNT(c.id) AS concessions,
              SUM(CASE WHEN EXISTS (SELECT 1 FROM flags f WHERE f.concession_id = c.id) THEN 1 ELSE 0 END) AS flagged
       FROM grantors g LEFT JOIN concessions c ON c.grantor_id = g.id
       GROUP BY g.id ORDER BY concessions DESC, g.name`,
    )
    .all();
}

const grantorByLatin = new WeakMap<Database.Database, Map<string, string>>();
/**
 * Концедентът зад сегмента от адреса: латинският slug или старият на
 * кирилица. `slug` е каноничният латински - при разлика страницата прави 301.
 */
export function getGrantor(param: string) {
  const db = getDb();
  if (!db) return null;
  let byLatin = grantorByLatin.get(db);
  if (!byLatin) {
    byLatin = new Map(
      db
        .prepare<[], { id: string }>("SELECT id FROM grantors")
        .all()
        .map((g) => [grantorSlug(g.id.slice(3)), g.id] as const),
    );
    grantorByLatin.set(db, byLatin);
  }
  const id = byLatin.get(param) ?? `gr:${param}`;
  const grantor = db
    .prepare<[string], { id: string; name: string; kind: string }>(
      "SELECT id, name, kind FROM grantors WHERE id = ?",
    )
    .get(id);
  if (!grantor) return null;
  const { rows } = listConcessions({
    grantor: grantor.id.slice(3),
    limit: 500,
  });
  return { grantor, slug: grantorSlug(grantor.id.slice(3)), concessions: rows };
}

/** Името на компания по ЕИК - за адреса ѝ (paths.companyHref). */
export function getCompanyName(eik: string): string | null {
  const db = getDb();
  if (!db) return null;
  return (
    db
      .prepare<[string], { name: string }>(
        "SELECT name FROM concessionaires WHERE eik = ?",
      )
      .get(eik)?.name ?? null
  );
}

export interface CompanyRow {
  eik: string | null;
  name: string;
  idkey: string;
  concessions: number;
  total_annual_eur: number | null;
}

export function listCompanies(): CompanyRow[] {
  const db = getDb();
  if (!db) return [];
  return db
    .prepare<[], CompanyRow>(
      `SELECT co.eik, co.name, co.id AS idkey,
              COUNT(c.id) AS concessions,
              SUM(c.annual_payment_eur) AS total_annual_eur
       FROM concessionaires co LEFT JOIN concessions c ON c.concessionaire_id = co.id
       GROUP BY co.id ORDER BY concessions DESC, co.name`,
    )
    .all();
}

/**
 * Съседни партиди за детайлната страница: същият концедент и същият вид
 * обект. Дава хоризонтални връзки между 1500+ страници, които иначе са
 * достижими само от sitemap-а.
 */
export function relatedConcessions(
  regNum: string,
  limit = 6,
): { byGrantor: ConcessionRow[]; byKind: ConcessionRow[] } {
  const db = getDb();
  if (!db) return { byGrantor: [], byKind: [] };
  const seed = db
    .prepare<
      [string],
      { id: string; grantor_id: string | null; kind: string | null }
    >(
      `SELECT c.id, c.grantor_id, (SELECT o.kind FROM objects o
          WHERE o.concession_id = c.id ORDER BY o.seq LIMIT 1) AS kind
       FROM concessions c WHERE c.reg_num = ?`,
    )
    .get(regNum);
  if (!seed) return { byGrantor: [], byKind: [] };

  const byGrantor = seed.grantor_id
    ? withSlugs(
        db,
        db
          .prepare<[string, string, number], ListRow>(
            `${LIST_SQL} WHERE c.grantor_id = ? AND c.id <> ?
             ORDER BY (c.annual_payment_eur IS NULL), c.annual_payment_eur DESC, c.reg_num
             LIMIT ?`,
          )
          .all(seed.grantor_id, seed.id, limit),
      )
    : [];
  const byKind = seed.kind
    ? withSlugs(
        db,
        db
          .prepare<[string, string, string | null, number], ListRow>(
            `${LIST_SQL} WHERE o.kind = ? AND c.id <> ?
             AND (c.grantor_id IS NULL OR c.grantor_id <> ?)
             ORDER BY (c.annual_payment_eur IS NULL), c.annual_payment_eur DESC, c.reg_num
             LIMIT ?`,
          )
          .all(seed.kind, seed.id, seed.grantor_id, limit),
      )
    : [];
  return { byGrantor, byKind };
}

/** Концедентите с най-много партиди - за вътрешните връзки на началната. */
export function topGrantors(limit: number): GrantorRow[] {
  return listGrantors().slice(0, limit);
}

export function getCompany(eik: string) {
  const db = getDb();
  if (!db) return null;
  const company = db
    .prepare<
      [string],
      { id: string; name: string; eik: string | null; address: string | null }
    >("SELECT id, name, eik, address FROM concessionaires WHERE eik = ?")
    .get(eik);
  if (!company) return null;
  const concessions = withSlugs(
    db,
    db
      .prepare<[string], ListRow>(
        `${LIST_SQL} WHERE co.id = ? ORDER BY c.reg_num`,
      )
      .all(company.id),
  );
  return { company, concessions };
}

export interface FlaggedRow extends ConcessionRow {
  flag_codes: string; // "LOW_PAYMENT,LONG_TERM"
  flag_count: number;
}

export function listFlagged(code?: string | null): FlaggedRow[] {
  const db = getDb();
  if (!db) return [];
  const codeCond = code
    ? "AND EXISTS (SELECT 1 FROM flags fx WHERE fx.concession_id = c.id AND fx.code = @code)"
    : "";
  return withSlugs(
    db,
    db
      .prepare<[Record<string, string>], ListRow>(
        `${LIST_SQL}
       WHERE EXISTS (SELECT 1 FROM flags f WHERE f.concession_id = c.id) ${codeCond}
       ORDER BY (SELECT COUNT(*) FROM flags f WHERE f.concession_id = c.id) DESC, c.reg_num`,
      )
      .all(code ? { code } : {}),
  ).map((r) => {
    const codes = getDb()!
      .prepare<[string], { code: string }>(
        "SELECT code FROM flags WHERE concession_id = (SELECT id FROM concessions WHERE reg_num = ?) ORDER BY code",
      )
      .all(r.reg_num)
      .map((x) => x.code);
    return { ...r, flag_codes: codes.join(","), flag_count: codes.length };
  });
}

export function listFlagCodes(): Array<{ code: string; n: number }> {
  const db = getDb();
  if (!db) return [];
  return db
    .prepare<[], { code: string; n: number }>(
      "SELECT code, COUNT(*) AS n FROM flags GROUP BY code ORDER BY n DESC",
    )
    .all();
}

export function kindCounts(): Array<{ kind: string; n: number }> {
  const db = getDb();
  if (!db) return [];
  return db
    .prepare<[], { kind: string; n: number }>(
      "SELECT kind, COUNT(*) AS n FROM objects GROUP BY kind ORDER BY n DESC",
    )
    .all();
}

export interface KindStats {
  total: number;
  grantors: number;
  with_payment: number;
  annual_sum: number | null;
  with_term: number;
  avg_term_months: number | null;
  flagged: number;
}

/** Обобщение за страницата по вид обект: само числа от базата. */
export function kindStats(kind: string): KindStats {
  const empty: KindStats = {
    total: 0,
    grantors: 0,
    with_payment: 0,
    annual_sum: null,
    with_term: 0,
    avg_term_months: null,
    flagged: 0,
  };
  const db = getDb();
  if (!db) return empty;
  return (
    db
      .prepare<[string], KindStats>(
        `SELECT COUNT(*) AS total,
                COUNT(DISTINCT c.grantor_id) AS grantors,
                SUM(c.annual_payment_eur IS NOT NULL) AS with_payment,
                SUM(c.annual_payment_eur) AS annual_sum,
                SUM(c.term_months IS NOT NULL) AS with_term,
                AVG(c.term_months) AS avg_term_months,
                SUM(EXISTS (SELECT 1 FROM flags f WHERE f.concession_id = c.id)) AS flagged
         FROM concessions c
         JOIN objects o ON o.concession_id = c.id AND o.seq = 1
         WHERE o.kind = ?`,
      )
      .get(kind) ?? empty
  );
}

export interface CompletenessStats {
  total: number;
  with_payment: number;
  with_concessionaire: number;
  with_term: number;
  with_value: number;
  without_status: number;
}

/** Колко от партидите носят кое поле - основата на „какво липсва". */
export function completenessStats(): CompletenessStats | null {
  const db = getDb();
  if (!db) return null;
  return (
    db
      .prepare<[], CompletenessStats>(
        `SELECT COUNT(*) AS total,
                SUM(annual_payment_eur IS NOT NULL) AS with_payment,
                SUM(concessionaire_id IS NOT NULL) AS with_concessionaire,
                SUM(term_months IS NOT NULL) AS with_term,
                SUM(value_eur IS NOT NULL) AS with_value,
                SUM(status IS NULL OR status = '') AS without_status
         FROM concessions`,
      )
      .get() ?? null
  );
}

export interface TermBand {
  with_term: number;
  over_25y: number;
  over_35y: number;
  max_months: number | null;
}

/** Разпределение на сроковете - за анализа на дългите концесии. */
export function termBands(kind?: string | null): TermBand {
  const empty: TermBand = {
    with_term: 0,
    over_25y: 0,
    over_35y: 0,
    max_months: null,
  };
  const db = getDb();
  if (!db) return empty;
  const where = kind
    ? `JOIN objects o ON o.concession_id = c.id AND o.seq = 1 AND o.kind = @kind`
    : "";
  return (
    db
      .prepare<[Record<string, string>], TermBand>(
        `SELECT SUM(c.term_months IS NOT NULL) AS with_term,
                SUM(c.term_months >= 300) AS over_25y,
                SUM(c.term_months >= 420) AS over_35y,
                MAX(c.term_months) AS max_months
         FROM concessions c ${where}`,
      )
      .get(kind ? { kind } : {}) ?? empty
  );
}

/** Партидите с най-голямо годишно възнаграждение за даден вид обект. */
export function topPaymentsByKind(kind: string, limit = 8): ConcessionRow[] {
  const db = getDb();
  if (!db) return [];
  return withSlugs(
    db,
    db
      .prepare<[string, number], ListRow>(
        `${LIST_SQL} WHERE o.kind = ? AND c.annual_payment_eur IS NOT NULL
         ORDER BY c.annual_payment_eur DESC, c.reg_num LIMIT ?`,
      )
      .all(kind, limit),
  );
}

/** Концедентите с най-много партиди за даден вид обект. */
export function topGrantorsByKind(
  kind: string,
  limit = 8,
): Array<{ slug: string; name: string; n: number }> {
  const db = getDb();
  if (!db) return [];
  return db
    .prepare<[string, number], { slug: string; name: string; n: number }>(
      `SELECT substr(g.id, 4) AS slug, g.name, COUNT(*) AS n
       FROM concessions c
       JOIN grantors g ON g.id = c.grantor_id
       JOIN objects o ON o.concession_id = c.id AND o.seq = 1
       WHERE o.kind = ? GROUP BY g.id ORDER BY n DESC, g.name LIMIT ?`,
    )
    .all(kind, limit);
}

/** Най-дългите срокове с вида на обекта - за анализа на сроковете. */
export function longestTerms(limit = 10): Array<ConcessionRow> {
  return topByTerm(limit);
}

export function topByTerm(limit: number): ConcessionRow[] {
  const db = getDb();
  if (!db) return [];
  return withSlugs(
    db,
    db
      .prepare<[number], ListRow>(
        `${LIST_SQL} WHERE c.term_months IS NOT NULL ORDER BY c.term_months DESC, c.reg_num LIMIT ?`,
      )
      .all(limit),
  );
}

export function lowestPaymentRatio(
  limit: number,
): Array<ConcessionRow & { ratio: number }> {
  const db = getDb();
  if (!db) return [];
  return withSlugs(
    db,
    db
      .prepare<[number], ListRow & { ratio: number }>(
        `SELECT ${LIST_COLS}, (c.annual_payment_eur / c.value_eur) AS ratio
       ${LIST_FROM}
       WHERE c.annual_payment_eur IS NOT NULL AND c.value_eur > 0
       ORDER BY ratio ASC, c.reg_num LIMIT ?`,
      )
      .all(limit),
  );
}

// ── Документите по партидата: текст, клаузи, търсене (E4) ────────────────

export interface DocumentRow {
  /** Стабилен ключ за адреса /koncesii/<slug>/dokumenti/<key>. */
  key: string;
  title: string | null;
  kind: string | null;
  /** Оригиналът в регистъра — винаги се показва до текста. */
  url: string;
  file_name: string | null;
  size_bytes: number | null;
  text_status: string | null;
  text_method: string | null;
  page_count: number | null;
}

export interface FactRow {
  field: string;
  value_raw: string;
  value_eur: number | null;
  term_months: number | null;
  percent: number | null;
  quote: string;
  page: number;
  outcome: string;
  document_url: string;
  document_key: string;
  document_title: string | null;
}

/**
 * Ключът на документа — същото правило като file_id в
 * tools/harvest/nkr_scraper.py: GUID-ът от /File/Download/{guid}, иначе
 * хеш на адреса. Не зависи от реда на редовете в базата, затова адресът на
 * страницата с текста е стабилен между обновяванията.
 */
export function documentKey(url: string): string {
  const m = /\/File\/Download\/([0-9a-f-]{36})/i.exec(url);
  if (m) return m[1]!.toLowerCase();
  let href = url;
  try {
    const u = new URL(url);
    href = u.pathname + u.search;
  } catch {
    // относителен адрес — хешира се както е
  }
  return createHash("sha1").update(href).digest("hex").slice(0, 20);
}

/**
 * Има ли базата текста на документите. Стара база без таблиците не бива
 * да чупи сайта — секциите за текст и търсене просто липсват.
 */
const documentTextSupport = new WeakMap<Database.Database, boolean>();
export function hasDocumentText(db: Database.Database): boolean {
  let ok = documentTextSupport.get(db);
  if (ok === undefined) {
    ok =
      (db
        .prepare<[], { n: number }>(
          "SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('document_pages_fts', 'extracted_facts')",
        )
        .get()?.n ?? 0) === 2;
    documentTextSupport.set(db, ok);
  }
  return ok;
}

function documentRows(
  db: Database.Database,
  concessionId: string,
): DocumentRow[] {
  const rows = hasDocumentText(db)
    ? db
        .prepare<[string], Omit<DocumentRow, "key">>(
          `SELECT title, kind, url, file_name, size_bytes, text_status, text_method, page_count
           FROM documents WHERE concession_id = ? ORDER BY id`,
        )
        .all(concessionId)
    : db
        .prepare<[string], Omit<DocumentRow, "key">>(
          `SELECT title, kind, url, NULL AS file_name, NULL AS size_bytes,
                  NULL AS text_status, NULL AS text_method, NULL AS page_count
           FROM documents WHERE concession_id = ? ORDER BY id`,
        )
        .all(concessionId);
  return rows.map((r) => ({ ...r, key: documentKey(r.url) }));
}

function factRows(
  db: Database.Database,
  concessionId: string,
  documentUrl?: string,
): FactRow[] {
  if (!hasDocumentText(db)) return [];
  const rows = db
    .prepare<
      [{ id: string; url: string | null }],
      Omit<FactRow, "document_key">
    >(
      `SELECT e.field, e.value_raw, e.value_eur, e.term_months, e.percent, e.quote,
              e.page, e.outcome, e.document_url, d.title AS document_title
       FROM extracted_facts e JOIN documents d ON d.id = e.document_id
       WHERE e.concession_id = @id AND (e.rank = 1 OR @url IS NOT NULL)
         AND (@url IS NULL OR e.document_url = @url)
       ORDER BY e.field, e.rank`,
    )
    .all({ id: concessionId, url: documentUrl ?? null });
  const order = (f: string) => {
    const i = FACT_ORDER.indexOf(f);
    return i === -1 ? FACT_ORDER.length : i;
  };
  return rows
    .map((r) => ({ ...r, document_key: documentKey(r.document_url) }))
    .sort((a, b) => order(a.field) - order(b.field));
}

export interface DocumentText {
  concession: { reg_num: string; title: string; slug: string };
  document: DocumentRow;
  pages: Array<{ page: number; method: string; text: string }>;
  /** Всички кандидати от този документ, не само избраните. */
  facts: FactRow[];
}

export function getDocumentText(
  regNum: string,
  key: string,
): DocumentText | null {
  const db = getDb();
  if (!db || !hasDocumentText(db)) return null;
  const c = db
    .prepare<[string], { id: string; reg_num: string; title: string }>(
      "SELECT id, reg_num, title FROM concessions WHERE reg_num = ?",
    )
    .get(regNum);
  if (!c) return null;
  const document = documentRows(db, c.id).find((d) => d.key === key);
  if (!document) return null;
  const docId = db
    .prepare<[string, string], { id: number }>(
      "SELECT id FROM documents WHERE concession_id = ? AND url = ? ORDER BY id LIMIT 1",
    )
    .get(c.id, document.url)?.id;
  const pages =
    docId == null
      ? []
      : db
          .prepare<[number], { page: number; method: string; text: string }>(
            "SELECT page, method, text FROM document_pages WHERE document_id = ? ORDER BY page",
          )
          .all(docId);
  return {
    concession: {
      reg_num: c.reg_num,
      title: c.title,
      slug: slugIndex(db).slugOf(c.reg_num),
    },
    document,
    pages,
    facts: factRows(db, c.id, document.url),
  };
}

/**
 * Окончания на българските съществителни и прилагателни (членувани и в
 * множествено число). FTS5 няма български stemmer, затова заявката търси
 * по основата: „гратисен" → гратис* намира „гратисният", „години" →
 * годин* намира „година". Само за заявката — индексът пази текста дословно.
 */
const BG_ENDINGS = [
  "ията",
  "ите",
  "ата",
  "ото",
  "ъта",
  "ята",
  "ият",
  "ия",
  "ът",
  "ят",
  "ове",
  "еве",
  "ен",
  "на",
  "но",
  "ни",
  "та",
  "то",
  "те",
  "и",
  "а",
  "о",
  "е",
  "я",
  "ь",
].sort((a, b) => b.length - a.length);

export function bgStem(word: string): string {
  const w = word.toLowerCase();
  if (!/^[\u0400-\u04ff]+$/.test(w) || w.length < 5) return w;
  for (const end of BG_ENDINGS) {
    if (w.endsWith(end) && w.length - end.length >= 4) {
      return w.slice(0, -end.length);
    }
  }
  return w;
}

/**
 * Потребителският текст → FTS5 заявка: всяка дума става префикс на
 * основата си в кавички ("язовир"* съвпада с „язовира"), думите се
 * свързват с И. Кавичките неутрализират синтаксиса на FTS5 — никакъв вход
 * не стига до него суров.
 */
export function ftsQuery(q: string): string | null {
  const words = q.normalize("NFKC").match(/[\p{L}\p{N}]+/gu) ?? [];
  if (words.length === 0) return null;
  return words
    .slice(0, 12)
    .map((w) => `"${bgStem(w)}"*`)
    .join(" ");
}

/** Маркерите на snippet() — не могат да се появят в текст от PDF/OCR. */
export const HIT_START = "\u0001";
export const HIT_END = "\u0002";

export interface DocumentHit {
  reg_num: string;
  slug: string;
  concession_title: string;
  document_key: string;
  document_title: string | null;
  document_url: string;
  page: number;
  method: string;
  /** Откъс с маркери HIT_START/HIT_END около съвпаденията. */
  snippet: string;
}

export function searchDocuments(
  q: string,
  limit = 50,
): { hits: DocumentHit[]; total: number } {
  const db = getDb();
  const match = ftsQuery(q);
  if (!db || !match || !hasDocumentText(db)) return { hits: [], total: 0 };
  try {
    const total =
      db
        .prepare<[string], { n: number }>(
          "SELECT COUNT(*) AS n FROM document_pages_fts WHERE document_pages_fts MATCH ?",
        )
        .get(match)?.n ?? 0;
    const rows = db
      .prepare<[string, number], Omit<DocumentHit, "slug" | "document_key">>(
        `SELECT c.reg_num, c.title AS concession_title, d.title AS document_title,
                d.url AS document_url, p.page, p.method,
                snippet(document_pages_fts, 0, char(1), char(2), '…', 24) AS snippet
         FROM document_pages_fts
         JOIN document_pages p ON p.id = document_pages_fts.rowid
         JOIN documents d ON d.id = p.document_id
         JOIN concessions c ON c.id = d.concession_id
         WHERE document_pages_fts MATCH ?
         ORDER BY bm25(document_pages_fts), c.reg_num, p.page
         LIMIT ?`,
      )
      .all(match, limit);
    return {
      hits: withSlugs(db, rows).map((r) => ({
        ...r,
        document_key: documentKey(r.document_url),
      })),
      total,
    };
  } catch {
    // неочаквана FTS грешка не бива да дава 500 на търсенето
    return { hits: [], total: 0 };
  }
}

/** Страниците с текст на документи за sitemap: slug, ключ, lastmod. */
export function documentPagesForSitemap(): Array<{
  slug: string;
  key: string;
  lastmod: string | null;
}> {
  const db = getDb();
  if (!db || !hasDocumentText(db)) return [];
  const idx = slugIndex(db);
  const fresh = hasFreshness(db);
  return db
    .prepare<[], { reg_num: string; url: string; changed_at: string | null }>(
      `SELECT c.reg_num, d.url, ${fresh ? "c.changed_at" : "NULL"} AS changed_at
       FROM documents d JOIN concessions c ON c.id = d.concession_id
       WHERE d.text_status = 'ok' GROUP BY c.reg_num, d.url ORDER BY c.reg_num, d.url`,
    )
    .all()
    .map((r) => ({
      slug: idx.slugOf(r.reg_num),
      key: documentKey(r.url),
      lastmod: r.changed_at,
    }));
}

/** Една точка на картата: партида с поне един гео-кодиран обект. */
export interface MapPoint {
  lat: number;
  lon: number;
  kind: string;
  reg_num: string;
  slug: string;
  /** кратък етикет (shortObjectTitle); пълното заглавие е на партидата */
  label: string;
  municipality: string | null;
  company: string | null;
  company_eik: string | null;
  term_months: number | null;
  annual_payment_eur: number | null;
  flags: string[];
  /** най-високата тежест: 0 без индикатор, 1 ниска, 2 средна, 3 висока */
  sev: number;
}

/**
 * Точките за картата: първият гео-кодиран обект на всяка партида, с
 * индикаторите ѝ. Подредени по тежест, за да е подреден и списъкът до картата.
 */
const mapPointsCache = new WeakMap<Database.Database, MapPoint[]>();
export function mapPoints(): MapPoint[] {
  const db = getDb();
  if (!db) return [];
  const cached = mapPointsCache.get(db);
  if (cached) return cached;
  const rows = db
    .prepare<
      [],
      Omit<MapPoint, "slug" | "label" | "flags" | "sev"> & {
        title: string;
        flag_codes: string | null;
        severities: string | null;
      }
    >(
      `SELECT o.lat, o.lon, o.kind, c.reg_num, c.title, o.municipality,
              ce.name AS company, ce.eik AS company_eik, c.term_months,
              c.annual_payment_eur,
              (SELECT group_concat(f.code) FROM flags f WHERE f.concession_id = c.id) AS flag_codes,
              (SELECT group_concat(f.severity) FROM flags f WHERE f.concession_id = c.id) AS severities
         FROM objects o
         JOIN concessions c ON c.id = o.concession_id
         LEFT JOIN concessionaires ce ON ce.id = c.concessionaire_id
        WHERE o.lat IS NOT NULL
          AND o.seq = (SELECT MIN(o2.seq) FROM objects o2
                        WHERE o2.concession_id = c.id AND o2.lat IS NOT NULL)`,
    )
    .all();
  const points = withSlugs(db, rows).map(
    ({ title, flag_codes, severities, ...r }) => ({
      ...r,
      label: shortObjectTitle(title),
      flags: flag_codes ? flag_codes.split(",") : [],
      sev: Math.max(
        0,
        ...(severities ?? "").split(",").map((v) => SEVERITY_RANK[v] ?? 0),
      ),
    }),
  );
  points.sort(
    (a, b) =>
      b.sev - a.sev ||
      b.flags.length - a.flags.length ||
      a.label.localeCompare(b.label, "bg"),
  );
  // базата е само за четене до следващия deploy - смятаме веднъж
  mapPointsCache.set(db, points);
  return points;
}

/** Брой партиди по код на индикатор, с тежестта му. */
export function flagCodeCounts(): Array<{
  code: string;
  severity: string;
  n: number;
}> {
  const db = getDb();
  if (!db) return [];
  return db
    .prepare<[], { code: string; severity: string; n: number }>(
      `SELECT code, MAX(severity) AS severity, COUNT(DISTINCT concession_id) AS n
         FROM flags GROUP BY code`,
    )
    .all()
    .sort(
      (a, b) =>
        (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0) ||
        b.n - a.n,
    );
}
