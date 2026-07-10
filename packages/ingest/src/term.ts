import type { ValueFlag } from "shared";
import { NO_DATA_RE, normText } from "./text";

export interface ParsedTerm {
  raw: string | null;
  /** Срокът, нормализиран в месеци: „420 месеца" и „35 години" дават 420. */
  months: number | null;
  flag: ValueFlag;
}

const NUM_RE = /(\d+(?:[.,]\d+)?)/;
const MONTH_UNIT_RE = /месец|мес\.?(?!т)/i;
const YEAR_UNIT_RE = /годин|год\.?|(?<=\d\s?)г\.?(?=\s|$)/iu;
/** „420 месеца", „35 години", „35 (тридесет и пет) години" — чист срок. */
const EXACT_RE =
  /^\d+(?:[.,]\d+)?\s*(?:\([^)]*\)\s*)?(месеца?|мес\.?|години?|годишен|год\.?|г\.?)$/iu;

export function parseTerm(rawInput: unknown): ParsedTerm {
  const raw = normText(rawInput);
  if (!raw || NO_DATA_RE.test(raw)) {
    return { raw: raw || null, months: null, flag: "missing" };
  }

  const m = NUM_RE.exec(raw);
  if (!m || !m[1]) return { raw, months: null, flag: "missing" };
  const n = Number(m[1].replace(",", "."));
  if (!Number.isFinite(n) || n <= 0)
    return { raw, months: null, flag: "missing" };

  let months: number;
  if (MONTH_UNIT_RE.test(raw)) {
    months = Math.round(n);
  } else if (YEAR_UNIT_RE.test(raw)) {
    months = Math.round(n * 12);
  } else {
    // Голо число без единица: общинските регистри пишат срока в години
    // („35"); стойност ≥ 100 не може да е години и се приема за месеци.
    months = n < 100 ? Math.round(n * 12) : Math.round(n);
    return { raw, months, flag: "parsed_from_text" };
  }

  return { raw, months, flag: EXACT_RE.test(raw) ? "ok" : "parsed_from_text" };
}
