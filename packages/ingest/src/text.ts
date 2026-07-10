// Текстова нормализация — еквивалент на norm_text от референтния
// tools/harvest/egov_concessions_harvest.py.
export function normText(input: unknown): string {
  if (input == null) return "";
  return String(input).normalize("NFKC").replace(/\s+/g, " ").trim();
}

/** „Няма въведени данни" е валидна и честа стойност в регистрите (docs/etl.md). */
export const NO_DATA_RE = /няма\s+(въведени\s+)?данни/i;
