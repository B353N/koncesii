import { moneyMatches, normalizeDocText } from "./documentFacts";

/**
 * Отчетите за изпълнение на концесионния договор (формулярът на НКР по
 * чл. 132, ал. 1 от Закона за концесиите) — т. 4.9 „Изпълнение на
 * задължението за концесионно възнаграждение": дължимото за отчетната
 * година и какво е отметнато за изпълнението му.
 *
 * Правила, не интерпретация. Отметката се чете само когато е еднозначна
 * (точно една от опциите е с ☒/☓/Х); иначе статусът остава неизвестен —
 * при OCR квадратчетата често излизат като шум. Платена сума се записва
 * само ако е изрично написана (при „частично") — „пълно изпълнение" не се
 * превръща в число.
 */

export type Fulfillment = "full" | "partial" | "none";

export interface ReportedPayment {
  /** Отчетната година от заглавието на формуляра. */
  year: number | null;
  /** Дословно написаното след „Дължим размер за отчетната година". */
  dueRaw: string | null;
  dueAmount: number | null;
  dueCurrency: "BGN" | "EUR" | null;
  dueEur: number | null;
  fulfillment: Fulfillment | null;
  /** Сумата при „частично" — само ако е написана. */
  paidRaw: string | null;
  paidEur: number | null;
  /** „Изпълнение в срок": да/не, ако е отметнато еднозначно. */
  onTime: boolean | null;
  /** „Дължими суми от предходни години": сумата, ако е отметнато „Да". */
  arrearsRaw: string | null;
  arrearsEur: number | null;
  /** Т. 4.9 дословно (нормализирани интервали) — показва се на сайта. */
  quote: string;
  /** Страницата с „Дължим размер" (от 1). */
  page: number;
}

/**
 * Годината в заглавието: „за [2024 г.] година (отчетна година)" или, без
 * скобата, „… от Закона за концесиите за 2022 година".
 */
const FORM_YEAR_RE = new RegExp(
  String.raw`за\s*\[?\s*((?:19|20)\d{2})\s*(?:г\.?)?\s*\]?\s*(?:г\.?\s*)?година\s*\(\s*отчетна\s+година\s*\)` +
    String.raw`|Закона\s+за\s+концесиите\s+за\s*\[?\s*((?:19|20)\d{2})\s*(?:г\.?)?\s*\]?\s*(?:г\.?\s*)?година`,
  "giu",
);

const DUE_RE = /Дължим\s+размер\s+за\s+отчетната\s+година/giu;

/** Краят на т. 4.9: следващата точка (лихви) или до ~900 знака. */
const SECTION_END_RE =
  /4\.10\.?|Изпълнение\s+на\s+задължения\s+за\s+лихви|4\.11\.?/iu;
const SECTION_MAX = 900;

/** Отметнато: ☒ ☑ ☓ ✓ ✔ ■ или самостоятелно X/Х (понякога до празно ☐). */
const CHECKED_RE = /(?:[☒☑☓✓✔✗✘■]|(?<![\p{L}\d])[XxХх])\s*☐?\s*$/u;
/** Празно квадратче точно преди опцията. */
const UNCHECKED_RE = /[☐□]\s*$/u;

const PLACEHOLDER_RE = /въведете/iu;

function mark(before: string): "checked" | "unchecked" | "unknown" {
  if (CHECKED_RE.test(before)) return "checked";
  if (UNCHECKED_RE.test(before)) return "unchecked";
  return "unknown";
}

/**
 * Коя опция е отметната: точно една „checked" и нито една „unknown" —
 * иначе null. `options` са регекси без флаг g, търсени в `text`.
 */
function checkedOption<T>(
  text: string,
  options: ReadonlyArray<readonly [T, RegExp]>,
): { value: T; at: number; end: number } | null {
  const found: Array<{ value: T; at: number; end: number; mark: string }> = [];
  for (const [value, re] of options) {
    const m = re.exec(text);
    if (!m) return null;
    found.push({
      value,
      at: m.index,
      end: m.index + m[0].length,
      // 8 знака назад: достатъчно за „☒ ", а „х" в края на дума се вижда като дума
      mark: mark(text.slice(Math.max(0, m.index - 8), m.index)),
    });
  }
  const checked = found.filter((f) => f.mark === "checked");
  if (checked.length !== 1 || found.some((f) => f.mark === "unknown")) {
    return null;
  }
  return checked[0]!;
}

const FULFILLMENT_OPTIONS = [
  ["full", /Пълно\s+изпълнение/iu],
  ["partial", /Частично/iu],
  ["none", /Пълно\s+неизпълнение/iu],
] as const;

const YES_NO_OPTIONS = [
  [true, /(?<![\p{L}])Да(?![\p{L}])/u],
  [false, /(?<![\p{L}])Не(?![\p{L}])/u],
] as const;

function firstMoney(text: string) {
  return moneyMatches(text).find((m) => !m.perUnit) ?? null;
}

/** Текстът между маркерите, без квадратните скоби на формуляра. */
function bracketText(s: string): string | null {
  const t = s
    .replace(/^\s*\[/, "")
    .replace(/\]?\s*(?:\d\)\s*\]?\s*)?$/, "")
    .replace(/[[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t || PLACEHOLDER_RE.test(t)) return null;
  return t.length > 200 ? `${t.slice(0, 200).trimEnd()}…` : t;
}

/** Всички т. 4.9 в документа (сборен PDF може да носи няколко години). */
export function extractReportedPayments(
  pages: readonly string[],
): ReportedPayment[] {
  const texts = pages.map(normalizeDocText);
  // Целият документ в един низ, с начало на всяка страница — т. 4.9
  // понякога продължава на следващата страница.
  const starts: number[] = [];
  let all = "";
  for (const t of texts) {
    starts.push(all.length);
    all += t + " ";
  }
  const pageAt = (offset: number) => {
    let p = 0;
    while (p + 1 < starts.length && starts[p + 1]! <= offset) p++;
    return p + 1;
  };

  const years: Array<{ at: number; year: number }> = [];
  for (const m of all.matchAll(FORM_YEAR_RE)) {
    years.push({ at: m.index, year: Number(m[1] ?? m[2]) });
  }

  const out: ReportedPayment[] = [];
  for (const m of all.matchAll(DUE_RE)) {
    const from = m.index;
    let section = all.slice(from, from + SECTION_MAX);
    const end = SECTION_END_RE.exec(section.slice(m[0].length));
    if (end) section = section.slice(0, m[0].length + end.index);

    const afterDue = section.slice(m[0].length);
    const sizeAt = afterDue.search(/(?:\d\)\s*)?Изпълнение\s+на\s+размера/iu);
    const dueText = sizeAt >= 0 ? afterDue.slice(0, sizeAt) : "";
    const rest = sizeAt >= 0 ? afterDue.slice(sizeAt) : afterDue;

    const dueRaw = bracketText(dueText);
    const due = dueRaw ? firstMoney(dueText) : null;

    const onTimeAt = rest.search(/Изпълнение\s+в\s+срок/iu);
    const sizePart = onTimeAt >= 0 ? rest.slice(0, onTimeAt) : rest;
    const fulfillment = checkedOption(sizePart, FULFILLMENT_OPTIONS);
    let paid = null;
    if (fulfillment?.value === "partial") {
      const after = sizePart.slice(fulfillment.end);
      const stop = after.search(/Пълно\s+неизпълнение/iu);
      paid = firstMoney(stop >= 0 ? after.slice(0, stop) : after);
    }

    let onTime: boolean | null = null;
    if (onTimeAt >= 0) {
      const tail = rest.slice(onTimeAt);
      const stop = tail.search(/\d\)\s*Дължими\s+суми|Дължими\s+суми/iu);
      const part = (stop >= 0 ? tail.slice(0, stop) : tail).slice(0, 160);
      onTime = checkedOption(part, YES_NO_OPTIONS)?.value ?? null;
    }

    let arrears = null;
    const arrearsAt = rest.search(/Дължими\s+суми\s+от\s+предходни\s+години/iu);
    if (arrearsAt >= 0) {
      const tail = rest.slice(arrearsAt);
      const stop = tail.search(/Платени\s+суми/iu);
      const part = (stop >= 0 ? tail.slice(0, stop) : tail).slice(0, 200);
      const yes = checkedOption(part, YES_NO_OPTIONS);
      if (yes?.value === true) arrears = firstMoney(part.slice(yes.end));
    }

    // Без дължимо и без отметка няма какво да се запише (празен формуляр,
    // „не е приложимо").
    if (!dueRaw && !fulfillment) continue;

    const year = years.filter((y) => y.at < from).at(-1)?.year ?? null;
    out.push({
      year,
      dueRaw,
      dueAmount: due?.amount ?? null,
      dueCurrency: due?.currency ?? null,
      dueEur: due?.eur ?? null,
      fulfillment: fulfillment?.value ?? null,
      paidRaw: paid?.raw ?? null,
      paidEur: paid?.eur ?? null,
      onTime,
      arrearsRaw: arrears?.raw ?? null,
      arrearsEur: arrears?.eur ?? null,
      quote: section.trim(),
      page: pageAt(from),
    });
  }
  return out;
}
