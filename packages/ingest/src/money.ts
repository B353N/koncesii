import { BGN_PER_EUR, type ValueFlag } from "shared";
import { NO_DATA_RE, normText } from "./text";

export interface ParsedMoney {
  /** Суровият низ, както е в източника — никога не се презаписва. */
  raw: string | null;
  value: number | null;
  currency: "BGN" | "EUR" | null;
  /** Нормализирана стойност в евро (фиксиран курс 1.95583 за BGN). */
  eur: number | null;
  flag: ValueFlag;
}

const MONEY_RE = /(\d[\d\s .,]*)\s*(лв\.?|лева|bgn|евро|eur|€)?/iu;
const EUR_UNITS = new Set(["евро", "eur", "€"]);

/**
 * „1 234,56" и „1,234.56" → 1234.56. Следва референтната логика от
 * parse_payment в egov_concessions_harvest.py: при само запетая тя се
 * приема за десетичен знак.
 */
export function parseDecimal(numRaw: string): number | null {
  let num = numRaw.replace(/[\s ]/g, "").replace(/[.,]+$/, "");
  if (!num) return null;
  if (num.includes(",") && num.includes(".")) {
    num =
      num.lastIndexOf(".") > num.lastIndexOf(",")
        ? num.replaceAll(",", "")
        : num.replaceAll(".", "").replace(",", ".");
  } else if (num.includes(",")) {
    num = num.replace(",", ".");
  }
  const value = Number(num);
  return Number.isFinite(value) ? value : null;
}

export function eurFrom(value: number, currency: "BGN" | "EUR"): number {
  const eur = currency === "EUR" ? value : value / BGN_PER_EUR;
  return Math.round(eur * 100) / 100;
}

/**
 * Извлича парична стойност от регистров низ. Флагът документира качеството:
 * `ok` — низът е само число + валута; `parsed_from_text` — числото е извадено
 * от по-дълъг свободен текст или валутата е подразбрана (регистрите
 * деноминират в лв., когато не е посочена); `missing` — няма число.
 */
export function parseMoney(rawInput: unknown): ParsedMoney {
  const raw = normText(rawInput);
  const none: ParsedMoney = {
    raw: raw || null,
    value: null,
    currency: null,
    eur: null,
    flag: "missing",
  };
  if (!raw) return none;

  // Формулярите смесват стойност и празни подполета в един низ
  // („Да Размер (BGN без ДДС): 685,13 лв. или Няма въведени данни Срок…").
  // Парсваме само частта преди „Няма въведени данни" — число след фразата
  // принадлежи на друго подполе.
  const cutAt = raw.search(NO_DATA_RE);
  const scope = cutAt === -1 ? raw : raw.slice(0, cutAt);
  if (!scope.trim()) return none;

  const m = MONEY_RE.exec(scope);
  if (!m || !m[1]) return none;

  const value = parseDecimal(m[1]);
  if (value == null) return none;

  const unit = (m[2] ?? "").toLowerCase().replace(/\.$/, "");
  const explicitCurrency = unit
    ? EUR_UNITS.has(unit)
      ? ("EUR" as const)
      : ("BGN" as const)
    : null;
  const currency = explicitCurrency ?? "BGN";

  const exact = normText(m[0]) === raw;
  const flag: ValueFlag = exact && explicitCurrency ? "ok" : "parsed_from_text";

  return { raw, value, currency, eur: eurFrom(value, currency), flag };
}
