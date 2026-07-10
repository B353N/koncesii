import type Database from "better-sqlite3";

/**
 * Integrity отчетът на ingest: бройки по таблици, суми в EUR и брой
 * флагнати концесии. db:push го проверява повторно преди публикуване —
 * несъответствие спира публикацията.
 */
export interface IntegrityReport {
  snapshot_date: string;
  tables: Record<string, number>;
  sum_value_eur: number;
  sum_annual_payment_eur: number;
  flagged_concessions: number;
  review_queue_open: number;
}

const TABLES = [
  "raw_nkr_export",
  "raw_nkr_announcements",
  "raw_old_concessions",
  "raw_egov_rows",
  "grantors",
  "concessionaires",
  "procedures",
  "concessions",
  "objects",
  "payments",
  "documents",
  "flags",
  "rollups",
  "review_queue",
];

export function integrityReport(
  db: Database.Database,
  date: string,
): IntegrityReport {
  const tables: Record<string, number> = {};
  for (const t of TABLES) {
    const row = db
      .prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)
      .get();
    tables[t] = row?.n ?? 0;
  }
  const sum = (sql: string) =>
    Math.round(
      ((db.prepare<[], { s: number | null }>(sql).get()?.s ?? 0) +
        Number.EPSILON) *
        100,
    ) / 100;

  return {
    snapshot_date: date,
    tables,
    sum_value_eur: sum("SELECT SUM(value_eur) AS s FROM concessions"),
    sum_annual_payment_eur: sum(
      "SELECT SUM(annual_payment_eur) AS s FROM concessions",
    ),
    flagged_concessions:
      db
        .prepare<[], { n: number }>(
          "SELECT COUNT(DISTINCT concession_id) AS n FROM flags",
        )
        .get()?.n ?? 0,
    review_queue_open:
      db
        .prepare<[], { n: number }>(
          "SELECT COUNT(*) AS n FROM review_queue WHERE status = 'open'",
        )
        .get()?.n ?? 0,
  };
}

export function verifyReport(
  db: Database.Database,
  expected: IntegrityReport,
): string[] {
  const actual = integrityReport(db, expected.snapshot_date);
  const problems: string[] = [];
  for (const [t, n] of Object.entries(expected.tables)) {
    if (actual.tables[t] !== n) {
      problems.push(`${t}: очаквани ${n} реда, намерени ${actual.tables[t]}`);
    }
  }
  for (const key of [
    "sum_value_eur",
    "sum_annual_payment_eur",
    "flagged_concessions",
  ] as const) {
    if (actual[key] !== expected[key]) {
      problems.push(
        `${key}: очаквано ${expected[key]}, намерено ${actual[key]}`,
      );
    }
  }
  return problems;
}
