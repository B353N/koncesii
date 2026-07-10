import type Database from "better-sqlite3";

/**
 * Derive стъпката: изчислява индикаторите по публичната методология
 * (docs/red-flags.md). Всеки флаг е възпроизводим аритметичен факт с
 * формулата и входните числа в inputs — никога твърдение за нарушение.
 * Изчислява се само тук, никога в заявка на живо.
 */

interface ConcessionRow {
  id: string;
  value_eur: number | null;
  annual_payment_eur: number | null;
  annual_payment_flag: string;
  onetime_payment_flag: string;
  value_flag: string;
  term_flag: string;
  term_months: number | null;
  grace_period_months: number | null;
  has_indexation: number | null;
  bidder_count: number | null;
}

export function deriveFlags(db: Database.Database, date: string): number {
  const insert = db.prepare(
    `INSERT INTO flags (id, concession_id, code, severity, inputs, computed_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const rows = db
    .prepare<[], ConcessionRow>(
      `SELECT c.id, c.value_eur, c.annual_payment_eur, c.annual_payment_flag,
              c.onetime_payment_flag, c.value_flag, c.term_flag, c.term_months,
              c.grace_period_months, c.has_indexation, p.bidder_count
       FROM concessions c LEFT JOIN procedures p ON p.id = c.procedure_id
       ORDER BY c.id`,
    )
    .all();

  let n = 0;
  const add = (id: string, code: string, severity: string, inputs: object) => {
    insert.run(
      `flag:${id}:${code}`,
      id,
      code,
      severity,
      JSON.stringify(inputs),
      date,
    );
    n++;
  };

  for (const c of rows) {
    // LOW_PAYMENT: годишно / стойност < 1% (при налични двете)
    if (
      c.annual_payment_eur != null &&
      c.value_eur != null &&
      c.value_eur > 0
    ) {
      const ratio = c.annual_payment_eur / c.value_eur;
      if (ratio < 0.01) {
        add(c.id, "LOW_PAYMENT", "high", {
          annual_payment_eur: c.annual_payment_eur,
          value_eur: c.value_eur,
          ratio: Math.round(ratio * 1e6) / 1e6,
          threshold: 0.01,
        });
      }
    }

    // LONG_TERM: срок ≥ 300 месеца; отделно ниво ≥ 420
    if (c.term_months != null && c.term_months >= 300) {
      add(c.id, "LONG_TERM", "medium", {
        term_months: c.term_months,
        threshold_months: 300,
        level: c.term_months >= 420 ? 2 : 1,
      });
    }

    // GRACE_PERIOD: гратисен период ≥ 24 месеца
    if (c.grace_period_months != null && c.grace_period_months >= 24) {
      add(c.id, "GRACE_PERIOD", "medium", {
        grace_period_months: c.grace_period_months,
        threshold_months: 24,
      });
    }

    // NO_INDEXATION: липсва клауза за индексация при срок ≥ 120 месеца
    if (
      c.term_months != null &&
      c.term_months >= 120 &&
      c.has_indexation === 0
    ) {
      add(c.id, "NO_INDEXATION", "medium", {
        term_months: c.term_months,
        has_indexation: false,
      });
    }

    // SINGLE_BIDDER: един участник (където броят е публикуван)
    if (c.bidder_count === 1) {
      add(c.id, "SINGLE_BIDDER", "high", { bidder_count: 1 });
    }

    // MISSING_MONEY: нито еднократно, нито годишно възнаграждение
    if (
      c.annual_payment_flag === "missing" &&
      c.onetime_payment_flag === "missing"
    ) {
      add(c.id, "MISSING_MONEY", "low", {
        annual_payment: "missing",
        onetime_payment: "missing",
      });
    }

    // DATA_CONFLICT: противоречиви стойности между източниците
    const conflicted = (
      [
        ["value", c.value_flag],
        ["annual_payment", c.annual_payment_flag],
        ["term", c.term_flag],
      ] as const
    ).filter(([, f]) => f === "contradictory");
    if (conflicted.length > 0) {
      add(c.id, "DATA_CONFLICT", "low", {
        fields: conflicted.map(([f]) => f),
      });
    }
  }
  return n;
}
