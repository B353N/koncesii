import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { normalizeDocText } from "ingest";

/**
 * pnpm coverage — колко от полетата на концесиите са попълнени, колко са
 * попълнени от документите и какво още липсва. Пише и извадка от местата
 * в документите на концесиите без суми/срок, където текстът явно говори
 * за възнаграждение или срок, но правилата (packages/ingest/src/
 * documentFacts.ts) не са намерили стойност — оттам се пишат нови правила.
 *
 *   pnpm coverage [--db build/koncesii.sqlite] [--sample 60] [--out build/coverage-sample.md]
 *
 * Извадката е детерминистична (подредба по хеш на партидата) — едно и
 * също пускане върху една и съща база дава същия файл.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

const FIELDS = [
  ["term", "term_flag", "срок"],
  ["annual_payment", "annual_payment_flag", "годишно възнаграждение"],
  ["onetime_payment", "onetime_payment_flag", "еднократно възнаграждение"],
  ["value", "value_flag", "стойност на концесията"],
] as const;

/** Думи, около които в договора обикновено стои цената/срокът. */
const MONEY_WORDS =
  /възнагражд|концесионн\p{L}*\s+плащан|наемн\p{L}*\s+цена|годишн\p{L}*\s+(?:такса|вноска|сума)|плаща\p{L}*\s+(?:на\s+концедента|сума)/giu;
const TERM_WORDS = /срок|години|месеца/giu;
const HAS_MONEY = /\d[\d\s.,]*\s*(?:лв|лева|евро|eur|€|bgn)/iu;
const HAS_TERM =
  /\d{1,3}\s*(?:\([^)]{0,40}\)\s*)?(?:години|година|месеца|г\.)/iu;

interface Snippet {
  reg: string;
  doc: string | null;
  url: string;
  page: number;
  text: string;
}

function order(id: string): string {
  return createHash("sha1").update(id).digest("hex");
}

/** Откъсите около думите, в които има и число с единица. */
function snippets(
  text: string,
  words: RegExp,
  has: RegExp,
  max: number,
): string[] {
  const out: string[] = [];
  words.lastIndex = 0;
  let lastEnd = -1;
  for (let m = words.exec(text); m && out.length < max; m = words.exec(text)) {
    const a = Math.max(0, m.index - 120);
    const b = Math.min(text.length, m.index + 260);
    if (a < lastEnd) continue; // без застъпване
    const s = text.slice(a, b);
    if (!has.test(s)) continue;
    out.push(`${a > 0 ? "…" : ""}${s.trim()}${b < text.length ? "…" : ""}`);
    lastEnd = b;
  }
  return out;
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  const v = i !== -1 ? process.argv[i + 1] : undefined;
  return v && !v.startsWith("--") ? v : fallback;
}

function main() {
  const dbPath = arg("--db", join(ROOT, "build/koncesii.sqlite"));
  const outPath = arg("--out", join(ROOT, "build/coverage-sample.md"));
  const sampleSize = Number(arg("--sample", "60"));
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });

  const total =
    db
      .prepare<[], { n: number }>(
        "SELECT COUNT(*) AS n FROM concessions WHERE source = 'nkr'",
      )
      .get()?.n ?? 0;
  console.log(`Концесии от НКР: ${total}\n`);
  console.log(
    "поле                        | от регистъра | от документи | противоречиви | липсват",
  );
  for (const [field, flag, label] of FIELDS) {
    const row = db
      .prepare<
        [string],
        { ok: number; docs: number; contra: number; missing: number }
      >(
        `SELECT
           SUM(${flag} IN ('ok', 'parsed_from_text') AND NOT EXISTS (
             SELECT 1 FROM extracted_facts e WHERE e.concession_id = c.id
               AND e.field = ? AND e.rank = 1 AND e.outcome = 'filled')) AS ok,
           SUM(EXISTS (SELECT 1 FROM extracted_facts e WHERE e.concession_id = c.id
               AND e.field = '${field}' AND e.rank = 1 AND e.outcome = 'filled')) AS docs,
           SUM(${flag} = 'contradictory') AS contra,
           SUM(${flag} = 'missing') AS missing
         FROM concessions c WHERE source = 'nkr'`,
      )
      .get(field)!;
    console.log(
      `${label.padEnd(27)} | ${String(row.ok).padStart(12)} | ${String(row.docs).padStart(12)} | ${String(row.contra).padStart(13)} | ${String(row.missing).padStart(7)}`,
    );
  }

  // Концесиите без никакво възнаграждение и какво има в документите им
  const noMoney = db
    .prepare<[], { id: string; reg_num: string }>(
      `SELECT id, reg_num FROM concessions
       WHERE source = 'nkr' AND annual_payment_flag = 'missing'
         AND onetime_payment_flag = 'missing'`,
    )
    .all();
  const withText = db.prepare<[string], { n: number }>(
    "SELECT COUNT(*) AS n FROM documents WHERE concession_id = ? AND text_status = 'ok'",
  );
  const pages = db.prepare<
    [string],
    { title: string | null; url: string; page: number; text: string }
  >(
    `SELECT d.title, d.url, p.page, p.text FROM document_pages p
     JOIN documents d ON d.id = p.document_id
     WHERE d.concession_id = ? ORDER BY d.id, p.page`,
  );

  let noDocs = 0;
  let docsNoMention = 0;
  const moneyCandidates: Array<{ key: string; snips: Snippet[] }> = [];
  for (const c of noMoney) {
    if ((withText.get(c.id)?.n ?? 0) === 0) {
      noDocs++;
      continue;
    }
    const snips: Snippet[] = [];
    for (const p of pages.all(c.id)) {
      for (const text of snippets(
        normalizeDocText(p.text),
        MONEY_WORDS,
        HAS_MONEY,
        2,
      )) {
        snips.push({
          reg: c.reg_num,
          doc: p.title,
          url: p.url,
          page: p.page,
          text,
        });
      }
      if (snips.length >= 3) break;
    }
    if (snips.length === 0) docsNoMention++;
    else moneyCandidates.push({ key: order(c.id), snips });
  }

  console.log(
    `\nБез годишно и без еднократно възнаграждение: ${noMoney.length}\n` +
      `  без документ с текст:                         ${noDocs}\n` +
      `  документите не споменават сума до „възнаграждение“: ${docsNoMention}\n` +
      `  документите споменават — кандидати за нови правила: ${moneyCandidates.length}`,
  );

  // Същото за срока
  const noTerm = db
    .prepare<[], { id: string; reg_num: string }>(
      "SELECT id, reg_num FROM concessions WHERE source = 'nkr' AND term_flag = 'missing'",
    )
    .all();
  const termCandidates: Array<{ key: string; snips: Snippet[] }> = [];
  for (const c of noTerm) {
    const snips: Snippet[] = [];
    for (const p of pages.all(c.id)) {
      for (const text of snippets(
        normalizeDocText(p.text),
        TERM_WORDS,
        HAS_TERM,
        1,
      )) {
        snips.push({
          reg: c.reg_num,
          doc: p.title,
          url: p.url,
          page: p.page,
          text,
        });
      }
      if (snips.length >= 2) break;
    }
    if (snips.length > 0) termCandidates.push({ key: order(c.id), snips });
  }
  console.log(
    `Без срок: ${noTerm.length}; документите споменават срок: ${termCandidates.length}`,
  );

  const pick = (list: typeof moneyCandidates, n: number) =>
    list.sort((a, b) => a.key.localeCompare(b.key)).slice(0, n);
  const fmt = (s: Snippet) =>
    `- **${s.reg}** · ${s.doc ?? "документ"}, стр. ${s.page}\n  > ${s.text.replace(/\n/g, " ")}`;

  const md =
    `# Извадка: какво казват документите, където правилата не намират стойност\n\n` +
    `База: ${dbPath}\n\n` +
    `## Суми (${Math.min(sampleSize, moneyCandidates.length)} от ${moneyCandidates.length} концесии)\n\n` +
    pick(moneyCandidates, sampleSize)
      .map((c) => c.snips.map(fmt).join("\n"))
      .join("\n\n") +
    `\n\n## Срок (${Math.min(Math.ceil(sampleSize / 3), termCandidates.length)} от ${termCandidates.length} концесии)\n\n` +
    pick(termCandidates, Math.ceil(sampleSize / 3))
      .map((c) => c.snips.map(fmt).join("\n"))
      .join("\n\n") +
    "\n";
  writeFileSync(outPath, md);
  console.log(`\nИзвадка → ${outPath}`);
  db.close();
}

main();
