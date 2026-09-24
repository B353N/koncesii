import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import Database from "better-sqlite3";

/**
 * Кога се е променила партидата.
 *
 * Сайтът трябва да казва на търсачките кога съдържанието на страницата е
 * станало различно (`lastmod`), а не кога е снет снапшотът: еднаква дата
 * на 2000 URL е шум, който Google игнорира. Затова при всеки ingest за
 * всяка партида се смята хеш на показваното съдържание и се сверява с
 * предишната публикувана база:
 *
 *   * същият хеш  → `changed_at` се пренася от предишната база;
 *   * различен или нов запис → `changed_at` = датата на снапшота.
 *
 * Детерминистично е: един и същи снапшот и една и съща предишна база
 * дават едни и същи стойности. Без предишна база (първо пускане, ingest
 * от фикстури) всичко получава датата на снапшота.
 */

export interface PreviousState {
  hash: string;
  changed_at: string;
}

/** Хешовете от предишната публикувана база; липсващ файл → празна карта. */
export function readPreviousState(
  path: string | null,
): Map<string, PreviousState> {
  const out = new Map<string, PreviousState>();
  if (!path || !existsSync(path)) return out;
  let db: Database.Database | null = null;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
    const hasColumns = db
      .prepare<[], { n: number }>(
        "SELECT COUNT(*) AS n FROM pragma_table_info('concessions') WHERE name IN ('content_hash', 'changed_at')",
      )
      .get();
    if ((hasColumns?.n ?? 0) < 2) return out;
    for (const row of db
      .prepare<
        [],
        { reg_num: string; content_hash: string; changed_at: string }
      >(
        "SELECT reg_num, content_hash, changed_at FROM concessions WHERE content_hash IS NOT NULL AND changed_at IS NOT NULL",
      )
      .iterate()) {
      out.set(row.reg_num, {
        hash: row.content_hash,
        changed_at: row.changed_at,
      });
    }
  } catch {
    // повредена или несъвместима предишна база не бива да спира ingest-а
    return new Map();
  } finally {
    db?.close();
  }
  return out;
}

/**
 * Проекцията, която се хешира: точно полетата, които стоят на страницата
 * на партидата. Служебните (fetched_at, id на снапшота) нарочно липсват -
 * иначе всяка седмица всичко „се променя“.
 */
const PROJECTION_SQL = `
  SELECT c.reg_num,
         c.title, c.kind, c.status, c.grantor_id, c.concessionaire_id,
         c.start_date, c.term_raw, c.term_months, c.term_flag,
         c.value_raw, c.value_eur, c.value_flag,
         c.onetime_payment_raw, c.onetime_payment_eur, c.onetime_payment_flag,
         c.annual_payment_raw, c.annual_payment_eur, c.annual_payment_flag,
         c.grace_period_months, c.grace_period_raw, c.indexation_raw,
         c.has_indexation, c.source, c.source_url, c.announcement_url,
         (SELECT group_concat(o.kind || '|' || o.description, '§')
            FROM (SELECT kind, description FROM objects
                   WHERE concession_id = c.id ORDER BY seq) o) AS objects,
         (SELECT group_concat(d.url || '|' || coalesce(d.title, '') || '|' ||
                              coalesce(d.sha256, '') || '|' || coalesce(d.page_count, ''), '§')
            FROM (SELECT url, title, sha256, page_count FROM documents
                   WHERE concession_id = c.id ORDER BY url) d) AS documents,
         (SELECT group_concat(e.field || '|' || e.value_raw || '|' || e.page || '|' ||
                              e.outcome || '|' || e.quote, '§')
            FROM (SELECT field, value_raw, page, outcome, quote FROM extracted_facts
                   WHERE concession_id = c.id AND rank = 1 ORDER BY field) e) AS extracted,
         (SELECT group_concat(f.code || '|' || f.inputs, '§')
            FROM (SELECT code, inputs FROM flags
                   WHERE concession_id = c.id ORDER BY code) f) AS flags,
         (SELECT group_concat(p.contracted_raw, '§')
            FROM (SELECT contracted_raw FROM payments
                   WHERE concession_id = c.id ORDER BY id) p) AS payments
    FROM concessions c
   ORDER BY c.reg_num`;

export function contentHash(row: Record<string, unknown>): string {
  const h = createHash("sha256");
  for (const [k, v] of Object.entries(row)) {
    if (k === "reg_num") continue;
    // JSON кодирането разделя еднозначно - стойност със знак за
    // разделител не може да се представи за две полета
    h.update(JSON.stringify([k, v == null ? null : String(v)]));
  }
  return h.digest("hex").slice(0, 32);
}

export interface ChangeStats {
  unchanged: number;
  changed: number;
  added: number;
}

/**
 * Попълва concessions.content_hash и concessions.changed_at. Връща
 * разбивка за лога и за integrity отчета.
 */
export function applyChangeTracking(
  db: Database.Database,
  previous: Map<string, PreviousState>,
  date: string,
): ChangeStats {
  const rows = db.prepare<[], Record<string, unknown>>(PROJECTION_SQL).all();
  const update = db.prepare<[string, string, string]>(
    "UPDATE concessions SET content_hash = ?, changed_at = ? WHERE reg_num = ?",
  );
  const stats: ChangeStats = { unchanged: 0, changed: 0, added: 0 };

  for (const row of rows) {
    const regNum = String(row["reg_num"]);
    const hash = contentHash(row);
    const prev = previous.get(regNum);
    let changedAt: string;
    if (!prev) {
      changedAt = date;
      stats.added++;
    } else if (prev.hash === hash) {
      changedAt = prev.changed_at;
      stats.unchanged++;
    } else {
      changedAt = date;
      stats.changed++;
    }
    update.run(hash, changedAt, regNum);
  }
  return stats;
}
