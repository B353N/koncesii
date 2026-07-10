import { getDb } from "./db.server";

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

  const rows = db
    .prepare<[Record<string, string | number>], ConcessionRow>(
      `${LIST_SQL}${cond} ORDER BY c.reg_num LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit: f.limit ?? 50, offset: f.offset ?? 0 });

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
  const concessions = db
    .prepare<[string], ConcessionRow>(
      `${LIST_SQL} WHERE co.id = ? ORDER BY c.reg_num`,
    )
    .all(company.id);
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
  return db
    .prepare<[Record<string, string>], FlaggedRow>(
      `${LIST_SQL}
       WHERE EXISTS (SELECT 1 FROM flags f WHERE f.concession_id = c.id) ${codeCond}
       ORDER BY (SELECT COUNT(*) FROM flags f WHERE f.concession_id = c.id) DESC, c.reg_num`,
    )
    .all(code ? { code } : {})
    .map((r) => {
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

export function topByTerm(limit: number): ConcessionRow[] {
  const db = getDb();
  if (!db) return [];
  return db
    .prepare<[number], ConcessionRow>(
      `${LIST_SQL} WHERE c.term_months IS NOT NULL ORDER BY c.term_months DESC, c.reg_num LIMIT ?`,
    )
    .all(limit);
}

export function lowestPaymentRatio(
  limit: number,
): Array<ConcessionRow & { ratio: number }> {
  const db = getDb();
  if (!db) return [];
  return db
    .prepare<[number], ConcessionRow & { ratio: number }>(
      `SELECT ${LIST_COLS}, (c.annual_payment_eur / c.value_eur) AS ratio
       ${LIST_FROM}
       WHERE c.annual_payment_eur IS NOT NULL AND c.value_eur > 0
       ORDER BY ratio ASC, c.reg_num LIMIT ?`,
    )
    .all(limit);
}

export function allRegNums(): string[] {
  const db = getDb();
  if (!db) return [];
  return db
    .prepare<[], { reg_num: string }>(
      "SELECT reg_num FROM concessions ORDER BY reg_num",
    )
    .all()
    .map((r) => r.reg_num);
}
