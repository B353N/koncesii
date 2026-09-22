import type Database from "better-sqlite3";
import { getDb } from "./db.server";
import { buildSlugIndex, type SlugIndex } from "./slug";

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
  /** URL slug на партидата (виж slug.ts); адресът е /concessions/<slug>. */
  slug: string;
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
 * Индексът номер ↔ slug се строи веднъж за отворената база (WeakMap по
 * handle: при атомарна подмяна на файла getDb() връща нов handle и
 * индексът се престроява).
 */
const slugIndexes = new WeakMap<Database.Database, SlugIndex>();
function slugIndex(db: Database.Database): SlugIndex {
  let idx = slugIndexes.get(db);
  if (!idx) {
    idx = buildSlugIndex(
      db
        .prepare<[], { reg_num: string }>("SELECT reg_num FROM concessions")
        .all()
        .map((r) => r.reg_num),
    );
    slugIndexes.set(db, idx);
  }
  return idx;
}

function withSlugs<T extends { reg_num: string }>(
  db: Database.Database,
  rows: T[],
): Array<T & { slug: string }> {
  const idx = slugIndex(db);
  return rows.map((r) => ({ ...r, slug: idx.slugOf(r.reg_num) }));
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
 * Разпознава сегмента от /concessions/<x>: каноничен slug, суров партиден
 * номер (стар адрес → 301) или номер, отрязан на "#" от търсачка, ако е
 * еднозначен. Връща null, ако няма такава партида.
 */
export function resolveConcession(
  param: string,
): { reg_num: string; slug: string } | null {
  const db = getDb();
  if (!db) return null;
  const idx = slugIndex(db);
  const bySlug = idx.regNumOf(param);
  if (bySlug) return { reg_num: bySlug, slug: param };
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
}

export interface PaymentRow {
  contracted_raw: string | null;
  contracted_eur: number | null;
  source_url: string;
}

export interface ConcessionDetail {
  concession: ConcessionFull;
  /** URL slug на партидата; адресът е /concessions/<slug>. */
  slug: string;
  grantor: { id: string; name: string } | null;
  concessionaire: { id: string; name: string; eik: string | null } | null;
  objects: ObjectRow[];
  documents: Array<{ title: string | null; kind: string | null; url: string }>;
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
        "SELECT id, description, kind, kind_raw FROM objects WHERE concession_id = ? ORDER BY seq",
      )
      .all(id),
    documents: db
      .prepare<
        [string],
        { title: string | null; kind: string | null; url: string }
      >(
        "SELECT title, kind, url FROM documents WHERE concession_id = ? ORDER BY id",
      )
      .all(id),
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

export function getGrantor(slug: string) {
  const db = getDb();
  if (!db) return null;
  const grantor = db
    .prepare<[string], { id: string; name: string; kind: string }>(
      "SELECT id, name, kind FROM grantors WHERE id = ?",
    )
    .get(`gr:${slug}`);
  if (!grantor) return null;
  const { rows } = listConcessions({ grantor: slug, limit: 500 });
  return { grantor, concessions: rows };
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
