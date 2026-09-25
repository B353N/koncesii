import { existsSync, readFileSync } from "node:fs";
import type Database from "better-sqlite3";
import {
  documentRank,
  extractDocAmounts,
  extractDocFacts,
  splitPages,
  type DocFact,
  type DocFactField,
} from "ingest";
import { textBase, type PageMethod, type TextMeta } from "./extract";
import type { Snapshot } from "./snapshot";

/**
 * Документите по партидите в базата (фаза E4 от docs/document-extraction.md).
 *
 *   1. метаданните на свалените файлове (манифестът) → documents;
 *   2. текстът по страници (кешът на pnpm extract) → document_pages + FTS;
 *   3. клаузите (E3) → extracted_facts, всички суми → document_amounts;
 *   4. попълване: избраният кандидат за поле попълва само ЛИПСВАЩО поле
 *      (flag 'parsed_from_text'); разминаване с регистъра → 'contradictory'
 *      + review_queue. Нищо не се презаписва (ADR-0003, „НКР печели").
 *
 * Ingest-ът чете само кеша — инструментите (poppler, tesseract) се пускат
 * от pnpm extract, така че един и същи снапшот дава една и съща база.
 */

export interface DocumentStats {
  documents: number;
  withText: number;
  pages: number;
  ocrPages: number;
  facts: number;
  filled: number;
  agrees: number;
  conflicts: number;
  amounts: number;
}

interface Candidate extends DocFact {
  documentId: number;
  documentUrl: string;
  docRank: number;
}

/** Колоните в concessions, които едно поле попълва. */
const COLUMNS: Partial<
  Record<DocFactField, { raw: string; num: string; flag: string | null }>
> = {
  term: { raw: "term_raw", num: "term_months", flag: "term_flag" },
  annual_payment: {
    raw: "annual_payment_raw",
    num: "annual_payment_eur",
    flag: "annual_payment_flag",
  },
  onetime_payment: {
    raw: "onetime_payment_raw",
    num: "onetime_payment_eur",
    flag: "onetime_payment_flag",
  },
  value: { raw: "value_raw", num: "value_eur", flag: "value_flag" },
  // гратисният период няма флаг: липсва ⇔ grace_period_months IS NULL
  grace_period: {
    raw: "grace_period_raw",
    num: "grace_period_months",
    flag: null,
  },
};

/** Сравнение в евро: закръгляването при превалутиране дава ±1 цент. */
function sameNumber(field: DocFactField, a: number, b: number): boolean {
  if (field === "term" || field === "grace_period") return a === b;
  return Math.abs(a - b) <= Math.max(0.02, Math.abs(b) * 0.0005);
}

const VAT = 1.2;

/**
 * Сумата от документа съвпада с регистъра, ако съвпада както е или след
 * премахване/добавяне на ДДС: договорите често дават сумата „с ДДС", а
 * формулярът — „без ДДС" (и обратното, въпреки етикета).
 */
function agreesWithRegistry(
  c: DocFact,
  value: number,
  registry: number,
): boolean {
  if (c.field === "term" || c.field === "grace_period") {
    return sameNumber(c.field, value, registry);
  }
  const variants =
    c.vat === "with"
      ? [value, value / VAT]
      : c.vat === "without"
        ? [value, value * VAT]
        : [value, value / VAT, value * VAT];
  return variants.some((v) => sameNumber(c.field, v, registry));
}

function numberOf(f: DocFact): number | null {
  return f.field === "term" || f.field === "grace_period" ? f.months : f.eur;
}

function textMethod(methods: PageMethod[]): "text" | "ocr" | "mixed" | null {
  const used = new Set(methods.filter((m) => m === "text" || m === "ocr"));
  if (used.size === 0) return null;
  if (used.size === 2) return "mixed";
  return used.has("ocr") ? "ocr" : "text";
}

export function ingestDocuments(
  db: Database.Database,
  snap: Snapshot,
  date: string,
): DocumentStats {
  const stats: DocumentStats = {
    documents: 0,
    withText: 0,
    pages: 0,
    ocrPages: 0,
    facts: 0,
    filled: 0,
    agrees: 0,
    conflicts: 0,
    amounts: 0,
  };

  const docs = db
    .prepare<
      [],
      { id: number; concession_id: string; title: string | null; url: string }
    >(
      "SELECT id, concession_id, title, url FROM documents WHERE kind = 'file' ORDER BY id",
    )
    .all();

  const updDoc = db.prepare(
    `UPDATE documents SET file_name = @file_name, content_type = @content_type,
       size_bytes = @size_bytes, sha256 = @sha256, text_status = @text_status,
       text_method = @text_method, page_count = @page_count, text_chars = @text_chars
     WHERE id = @id`,
  );
  const insPage = db.prepare(
    "INSERT INTO document_pages (document_id, page, method, text) VALUES (?, ?, ?, ?)",
  );
  const insAmount = db.prepare(
    `INSERT INTO document_amounts (document_id, concession_id, page, value_raw,
       amount, currency, value_eur, context) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  // Текстът на един файл се чете веднъж, дори да е закачен към няколко партиди.
  const textCache = new Map<
    string,
    { meta: TextMeta; pages: string[] } | null
  >();
  const loadText = (file: string) => {
    if (textCache.has(file)) return textCache.get(file)!;
    const base = textBase(snap.nkrDir, file);
    let out: { meta: TextMeta; pages: string[] } | null = null;
    if (existsSync(`${base}.meta.json`) && existsSync(`${base}.txt`)) {
      const meta = JSON.parse(
        readFileSync(`${base}.meta.json`, "utf8"),
      ) as TextMeta;
      const txt = readFileSync(`${base}.txt`, "utf8");
      out = { meta, pages: meta.pages > 0 ? splitPages(txt) : [] };
    }
    textCache.clear(); // само последният — текстовете са големи
    textCache.set(file, out);
    return out;
  };

  const candidates = new Map<string, Candidate[]>(); // concession → кандидати

  for (const doc of docs) {
    stats.documents++;
    const rec = snap.files.get(doc.url);
    const row = {
      id: doc.id,
      file_name: rec?.filename ?? null,
      content_type: rec?.content_type ?? null,
      size_bytes: rec?.size ?? null,
      sha256: rec?.sha256 ?? null,
      text_status: rec ? "not_extracted" : "not_downloaded",
      text_method: null as string | null,
      page_count: null as number | null,
      text_chars: null as number | null,
    };
    const text = rec?.file ? loadText(rec.file) : null;
    if (!text) {
      updDoc.run(row);
      continue;
    }

    const { meta, pages } = text;
    row.text_status = meta.status;
    row.page_count = meta.pages;
    row.text_chars = meta.chars;
    row.text_method = textMethod(meta.page_methods);
    updDoc.run(row);
    if (meta.status !== "ok") continue;
    stats.withText++;

    pages.forEach((p, i) => {
      const method = meta.page_methods[i] ?? "text";
      insPage.run(doc.id, i + 1, method, p);
      stats.pages++;
      if (method === "ocr") stats.ocrPages++;
    });

    const rank = documentRank(doc.title, rec?.filename);
    const list = candidates.get(doc.concession_id) ?? [];
    for (const f of extractDocFacts(pages)) {
      list.push({
        ...f,
        documentId: doc.id,
        documentUrl: doc.url,
        docRank: rank,
      });
    }
    candidates.set(doc.concession_id, list);

    for (const a of extractDocAmounts(pages)) {
      insAmount.run(
        doc.id,
        doc.concession_id,
        a.page,
        a.raw,
        a.amount,
        a.currency,
        a.eur,
        a.context,
      );
      stats.amounts++;
    }
  }

  db.prepare(
    "INSERT INTO document_pages_fts (document_pages_fts) VALUES ('rebuild')",
  ).run();

  const applied = applyFacts(db, candidates, date);
  stats.facts = applied.facts;
  stats.filled = applied.filled;
  stats.agrees = applied.agrees;
  stats.conflicts = applied.conflicts;
  return stats;
}

/**
 * Избор и прилагане. Кандидатите за едно поле в една партида се подреждат:
 * договорът преди решенията, после анексите (documentRank); пряката котва
 * преди общата; по-ранният документ, страница и позиция. Първият е rank 1.
 */
export function applyFacts(
  db: Database.Database,
  candidates: Map<string, Candidate[]>,
  date: string,
): { facts: number; filled: number; agrees: number; conflicts: number } {
  const out = { facts: 0, filled: 0, agrees: 0, conflicts: 0 };
  const insFact = db.prepare(
    `INSERT INTO extracted_facts (concession_id, document_id, field, value_raw,
       amount, currency, value_eur, term_months, percent, quote, page,
       document_url, anchor, priority, rank, outcome, method, extracted_at)
     VALUES (@concession_id, @document_id, @field, @value_raw, @amount, @currency,
       @value_eur, @term_months, @percent, @quote, @page, @document_url, @anchor,
       @priority, @rank, @outcome, 'regex', @extracted_at)`,
  );
  const insReview = db.prepare(
    "INSERT INTO review_queue (reason, payload, status, created_at) VALUES ('document_conflict', ?, 'open', ?)",
  );

  for (const concessionId of [...candidates.keys()].sort()) {
    const byField = new Map<DocFactField, Candidate[]>();
    for (const c of candidates.get(concessionId)!) {
      byField.set(c.field, [...(byField.get(c.field) ?? []), c]);
    }

    for (const field of [...byField.keys()].sort()) {
      const list = byField
        .get(field)!
        .sort(
          (a, b) =>
            a.docRank - b.docRank ||
            a.priority - b.priority ||
            a.documentId - b.documentId ||
            a.page - b.page ||
            a.offset - b.offset,
        );

      list.forEach((c, i) => {
        let outcome: Outcome | "alternative" = "alternative";
        if (i === 0) {
          outcome = applyOne(db, concessionId, c, insReview, date);
          if (outcome === "filled") out.filled++;
          if (outcome === "agrees") out.agrees++;
          if (outcome === "conflict") out.conflicts++;
        }
        insFact.run({
          concession_id: concessionId,
          document_id: c.documentId,
          field: c.field,
          value_raw: c.valueRaw,
          amount: c.amount,
          currency: c.currency,
          value_eur: c.eur,
          term_months: c.months,
          percent: c.percent,
          quote: c.quote,
          page: c.page,
          document_url: c.documentUrl,
          anchor: c.anchor,
          priority: c.priority,
          rank: i + 1,
          outcome,
          extracted_at: date,
        });
        out.facts++;
      });
    }
  }
  return out;
}

type Outcome = "filled" | "agrees" | "compatible" | "conflict" | "display";

/**
 * Срокът в документа е изрично без удълженията („Срок на концесията, без
 * предвидените удължавания: 180 месеца", „… за срок от 10 години, с
 * възможност да бъде продължен"), а регистърът е по-дълъг — това са две
 * различни величини, не противоречие.
 */
const EXCLUDES_EXTENSIONS_RE =
  /без\s+(?:\p{L}+\s+)?удължавани|възможност\p{L}*[^.;]{0,80}?(?:продълж|удълж)/iu;

function compatibleTerm(
  c: Candidate,
  value: number,
  registry: number,
): boolean {
  return (
    c.field === "term" &&
    registry > value &&
    EXCLUDES_EXTENSIONS_RE.test(c.quote)
  );
}

function applyOne(
  db: Database.Database,
  concessionId: string,
  c: Candidate,
  insReview: Database.Statement,
  date: string,
): Outcome {
  const cols = COLUMNS[c.field];
  const value = numberOf(c);
  if (!cols || value == null) return "display";

  const current = db
    .prepare<[string], Record<string, unknown>>(
      `SELECT ${cols.raw} AS raw, ${cols.num} AS num${cols.flag ? `, ${cols.flag} AS flag` : ""}
       FROM concessions WHERE id = ?`,
    )
    .get(concessionId);
  if (!current) return "display";
  const missing = cols.flag
    ? current["flag"] === "missing"
    : current["num"] == null;

  if (missing) {
    db.prepare(
      `UPDATE concessions SET ${cols.raw} = ?, ${cols.num} = ?${
        cols.flag ? `, ${cols.flag} = 'parsed_from_text'` : ""
      } WHERE id = ?`,
    ).run(c.valueRaw, value, concessionId);
    return "filled";
  }

  const currentNum = current["num"] as number | null;
  if (currentNum != null && agreesWithRegistry(c, value, currentNum)) {
    return "agrees";
  }
  if (currentNum != null && compatibleTerm(c, value, currentNum)) {
    return "compatible";
  }

  // Разминаване: регистърът печели, но противоречието се записва и флагва.
  if (cols.flag) {
    db.prepare(
      `UPDATE concessions SET ${cols.flag} = 'contradictory' WHERE id = ?`,
    ).run(concessionId);
  }
  insReview.run(
    JSON.stringify({
      concession: concessionId,
      field: c.field,
      registry: { raw: current["raw"], value: currentNum },
      document: {
        url: c.documentUrl,
        page: c.page,
        value_raw: c.valueRaw,
        value,
        quote: c.quote,
      },
    }),
    date,
  );
  return "conflict";
}
