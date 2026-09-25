import { eurFrom } from "./money";

/**
 * Детерминистично извличане на клаузи от текста на прикачените документи
 * (договори, решения) — фаза E3 от docs/document-extraction.md.
 *
 * Правила, не интерпретация: котва („срок на концесията", „годишно
 * концесионно възнаграждение" …) → прозорец след нея → първото число с
 * единица в прозореца. Всяко попадение носи страницата и дословния цитат
 * (с нормализирани интервали), от който е парснато. Един и същи текст дава
 * едно и също извличане.
 */

export type DocFactField =
  | "term"
  | "annual_payment"
  | "onetime_payment"
  | "value"
  | "grace_period"
  | "payment_percent";

export interface DocFact {
  field: DocFactField;
  /** Дословният фрагмент с числото и единицата: „25 (двадесет и пет) години". */
  valueRaw: string;
  /** Парите: стойността в оригиналната валута. */
  amount: number | null;
  currency: "BGN" | "EUR" | null;
  eur: number | null;
  /** Срок/гратисен период, в месеци. */
  months: number | null;
  /** Процент от приходите (payment_percent). */
  percent: number | null;
  /** Изречението около котвата и числото — показва се на сайта. */
  quote: string;
  /** Страница (от 1). */
  page: number;
  /** Котвата, по която е намерено — за методологията и прегледа. */
  anchor: string;
  /** 1 = пряка котва („срок на концесията"), 2 = по-обща. */
  priority: number;
  /** Позиция в нормализирания текст на страницата — за стабилна подредба. */
  offset: number;
  /** Парите: „с ДДС" / „без ДДС" веднага след сумата, ако е казано. */
  vat: "with" | "without" | null;
}

export interface DocAmount {
  raw: string;
  amount: number;
  currency: "BGN" | "EUR";
  eur: number;
  page: number;
  /** ±80 знака контекст около сумата. */
  context: string;
  offset: number;
}

/**
 * Текстът от pdftotext/OCR: пренесени думи („концеси-\nонно") се слепват,
 * всички интервали и нови редове стават един интервал. Цитатите на сайта
 * са от този нормализиран текст — думите и числата са дословни.
 */
export function normalizeDocText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/(\p{L})-[ \t]*\r?\n[ \t]*(\p{Ll})/gu, "$1$2")
    .replace(/[\s\u00a0\u00ad]+/g, " ")
    .trim();
}

/** Страниците на документ: pdftotext и extract разделят с form feed. */
export function splitPages(text: string): string[] {
  const pages = text.split("\f");
  // pdftotext завършва последната страница с \f — празната опашка не е страница
  if (pages.length > 1 && pages[pages.length - 1]!.trim() === "") pages.pop();
  return pages;
}

// ── Числа и пари ─────────────────────────────────────────────────────────

/**
 * „2 300,81" / „1.500,00" / „1,500.00" / „2300.81" / „127 114.36" /
 * „15000". Интервал или точка като разделител на хилядите, запетая (или
 * точка след групи с интервал) като десетичен знак.
 */
const NUM =
  String.raw`\d{1,3}(?:[ \u00a0]\d{3})+(?:[.,]\d{1,2})?` +
  String.raw`|\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?` +
  String.raw`|\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?` +
  String.raw`|\d+(?:[.,]\d{1,2})?`;
const MULT = String.raw`хил(?:\.|яди)?|млн\.?|милиона?`;
/** Сумата словом в скоби: „2300 (две хиляди и триста) лева". */
const WORDS = String.raw`\([^()]{0,200}\)`;
const CURRENCY = String.raw`лв\.?|лева|bgn|евро|eur|€`;

/**
 * Число не започва веднага след „цифра + интервал": „1312 500 лв." е
 * грешно групирано число, не сума от 500 лв. — такова число се пропуска.
 */
const MONEY_RE = new RegExp(
  String.raw`(?<![\d.,])(?<!\d[ \u00a0])(${NUM})\s*(?:(${MULT})\s*)?(?:${WORDS}\s*)?(${CURRENCY})(?![\p{L}])`,
  "giu",
);

/** „с ДДС" / „без ДДС" до 60 знака след сумата, в същото изречение. */
const VAT_WITH_RE = /^[^.;]{0,60}?(?<!\p{L})с\s+(?:включен\s+|вкл\.\s*)?ДДС/iu;
const VAT_WITHOUT_RE =
  /^[^.;]{0,60}?(?<!\p{L})без\s+(?:включен\s+|вкл\.\s*)?ДДС/iu;

function vatAfter(text: string, end: number): "with" | "without" | null {
  const tail = text.slice(end, end + 80);
  const w = VAT_WITH_RE.exec(tail);
  const wo = VAT_WITHOUT_RE.exec(tail);
  // първото споменаване печели: „1600 лв. без ДДС, съответно 1920 лв. с ДДС"
  if (w && (!wo || w[0].length < wo[0].length)) return "with";
  if (wo) return "without";
  return null;
}

/** Цена на единица (лв./кв.м, лв. на тон) не е обща сума. */
const PER_UNIT_RE =
  /^\s*(?:\/|на|за)\s*(?:1\s*)?(?:кв|м2|м²|дка|декар|тон|т\.|куб|м3|м³|бр|час|ден|месец)/iu;

/** Число в документен формат → стойност. Хилядите: интервал, точка или запетая по три. */
export function parseDocNumber(raw: string): number | null {
  const s = raw.replace(/[\s\u00a0]/g, "");
  let norm: string;
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(s)) {
    norm = s.replaceAll(".", "").replace(",", ".");
  } else if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(s)) {
    norm = s.replaceAll(",", "");
  } else {
    norm = s.replace(",", ".");
  }
  const v = Number(norm);
  return Number.isFinite(v) ? v : null;
}

function multiplier(raw: string | undefined): number {
  if (!raw) return 1;
  return /^млн|^милион/iu.test(raw) ? 1_000_000 : 1_000;
}

function currencyOf(unit: string): "BGN" | "EUR" {
  return /^(евро|eur|€)$/iu.test(unit) ? "EUR" : "BGN";
}

interface MoneyMatch {
  raw: string;
  amount: number;
  currency: "BGN" | "EUR";
  eur: number;
  start: number;
  end: number;
  perUnit: boolean;
  vat: "with" | "without" | null;
}

function moneyMatches(text: string): MoneyMatch[] {
  const out: MoneyMatch[] = [];
  MONEY_RE.lastIndex = 0;
  for (let m = MONEY_RE.exec(text); m; m = MONEY_RE.exec(text)) {
    const n = parseDocNumber(m[1]!);
    if (n == null || n <= 0) continue;
    const amount = Math.round(n * multiplier(m[2]) * 100) / 100;
    const currency = currencyOf(m[3]!);
    const end = m.index + m[0].length;
    out.push({
      raw: m[0].trim(),
      amount,
      currency,
      eur: eurFrom(amount, currency),
      start: m.index,
      end,
      perUnit: PER_UNIT_RE.test(text.slice(end, end + 25)),
      vat: vatAfter(text, end),
    });
  }
  return out;
}

// ── Срокове и проценти ───────────────────────────────────────────────────

const TERM_RE = new RegExp(
  // „[360] месеца" — формулярите на НКР слагат числото в квадратни скоби
  String.raw`(?<![\d.,])\[?(\d{1,4})\]?\s*(?:${WORDS}\s*)?(години|година|год\.|г\.|месеца|месец|мес\.)(?![\p{L}])`,
  "iu",
);

const PERCENT_RE =
  /(?<![\d.,])(\d{1,2}(?:[.,]\d{1,3})?)\s*(?:\([^()]{0,80}\)\s*)?(?:%|на\s+сто|процента?)(?![\p{L}])/iu;

// ── Котви ────────────────────────────────────────────────────────────────

interface Anchor {
  field: Exclude<DocFactField, "payment_percent">;
  re: RegExp;
  priority: number;
  name: string;
}

/**
 * Редът има значение само за четимостта: всяка котва се търси навсякъде.
 * „Еднократно" се проверява отделно от общото „концесионно възнаграждение",
 * за да не пълни годишното поле (както в unify.ts за формулярите).
 */
export const ANCHORS: readonly Anchor[] = [
  {
    field: "term",
    re: /срок\p{L}*\s+на\s+(?:самата\s+)?концесията/giu,
    priority: 1,
    name: "срок на концесията",
  },
  {
    field: "term",
    re: /концеси(?:я|ята)\s+се\s+(?:предоставя|възлага|учредява)\s+за\s+(?:срок|период)/giu,
    priority: 1,
    name: "концесията се предоставя за срок",
  },
  {
    field: "term",
    re: /(?:концесионн\p{L}*\s+)?договор\p{L}*\s+се\s+сключва\s+за\s+(?:срок|период)/giu,
    priority: 2,
    name: "договорът се сключва за срок",
  },
  {
    field: "onetime_payment",
    re: /еднократн\p{L}*\s+(?:концесионн\p{L}*\s+)?(?:възнаграждение|плащане)/giu,
    priority: 1,
    name: "еднократно концесионно възнаграждение",
  },
  {
    field: "annual_payment",
    re: /годишн\p{L}*\s+(?:концесионн\p{L}*\s+)?(?:възнаграждение|плащане)/giu,
    priority: 1,
    name: "годишно концесионно възнаграждение",
  },
  {
    field: "annual_payment",
    re: /концесионн\p{L}*\s+(?:възнаграждение|плащане)/giu,
    priority: 2,
    name: "концесионно възнаграждение … годишно",
  },
  {
    field: "value",
    re: /(?:прогнозн\p{L}*\s+)?стойност\p{L}*\s+на\s+концесията/giu,
    priority: 1,
    name: "стойност на концесията",
  },
  {
    field: "grace_period",
    re: /гратис(?:ен|н\p{L}*)\s+период\p{L}*/giu,
    priority: 1,
    name: "гратисен период",
  },
];

/** Всички котви заедно — прозорецът спира при следващата котва. */
const ANY_ANCHOR_RE = new RegExp(
  ANCHORS.map((a) => `(?:${a.re.source})`).join("|"),
  "iu",
);

/** Прозорецът спира и при нова точка/член от договора. */
const CLAUSE_BREAK_RE =
  /\s(?:чл\.|член)\s*\d|\s\d{1,2}\.\d{1,2}\.?\s|\s\(\d{1,2}\)\s/iu;

const WINDOW = 260;

/**
 * Рамки, при които числото не е стойността на концесията: законов максимум
 * („не може да бъде по-дълъг от 35 години"), удължаване, минимална тръжна
 * цена, гаранции и неустойки.
 */
/** Точно преди котвата: „Минималното годишно …", „максималният срок …". */
const SKIP_BEFORE_ANCHOR_RE =
  /(?:(?:минимал|максимал)\p{L}*|(?:удълж|продълж)\p{L}*(?:\s+\p{L}+){0,2})\s+$/iu;

const SKIP_PREFIX_RE =
  /не\s+може|по-дълъг|по-кратък|максимал|минимал|не\s+по-малк|удълж|продълж|изтичане|гаранци|неустойк|депозит|лихв|санкци|обезпечени/iu;

/** „Срок на концесията, без предвидените удължавания: [360] месеца" не е удължаване. */
const NOT_AN_EXTENSION_RE = /без\s+(?:\p{L}+\s+)?удължавани\p{L}*/giu;

function skipPrefix(prefix: string): boolean {
  return SKIP_PREFIX_RE.test(prefix.replace(NOT_AN_EXTENSION_RE, ""));
}

/** Годишното, когато котвата е общата: „… в размер на 5 000 лв. годишно". */
const ANNUAL_HINT_RE =
  /годишн|на\s+година|за\s+година|за\s+всяка\s+(?:календарна\s+)?година|на\s+годишна\s+база/iu;

function windowAfter(text: string, from: number): string {
  let w = text.slice(from, from + WINDOW);
  const next = ANY_ANCHOR_RE.exec(w);
  if (next && next.index > 0) w = w.slice(0, next.index);
  const brk = CLAUSE_BREAK_RE.exec(w);
  if (brk && brk.index > 0) w = w.slice(0, brk.index);
  return w;
}

/**
 * Ново изречение: точка/;/!/? + интервал + главна буква, кавичка или
 * номерирана алинея „(2)". „лв. (двеста…)" не е ново изречение.
 */
const SENTENCE_BREAK = String.raw`[.;!?]\s+(?=[\p{Lu}„"]|\(\d)`;

/**
 * Изречението около [start, end): от последната граница на изречение
 * преди котвата (до ~120 знака назад) до първата след числото (до ~160
 * напред). Многоточие отбелязва, че цитатът е отрязан.
 */
function quoteAround(text: string, start: number, end: number): string {
  const from = Math.max(0, start - 120);
  // +1: границата точно преди котвата изисква да видим първата ѝ буква
  const back = text.slice(from, start + 1);
  let a = from;
  let cutBack = from > 0;
  for (const m of back.matchAll(new RegExp(SENTENCE_BREAK, "gu"))) {
    const at = from + m.index + m[0].length;
    if (at <= start) {
      a = at;
      cutBack = false;
    }
  }
  if (from === 0) cutBack = false;

  const to = Math.min(text.length, end + 160);
  // напред: същата граница или краят на страницата
  const stop = new RegExp(`${SENTENCE_BREAK}|[.;!?]\\s*$`, "u").exec(
    text.slice(end, to),
  );
  const b = stop ? end + stop.index + 1 : to;
  const cutFwd = !stop && to < text.length;
  const body = text.slice(a, b).trim();
  return `${cutBack ? "…" : ""}${body}${cutFwd ? "…" : ""}`;
}

/** Извлечените клаузи от един документ, в реда на появяване. */
export function extractDocFacts(pages: readonly string[]): DocFact[] {
  const facts: DocFact[] = [];
  const seen = new Set<string>();

  pages.forEach((pageRaw, i) => {
    const text = normalizeDocText(pageRaw);
    const page = i + 1;

    for (const anchor of ANCHORS) {
      anchor.re.lastIndex = 0;
      for (let m = anchor.re.exec(text); m; m = anchor.re.exec(text)) {
        const aStart = m.index;
        const aEnd = m.index + m[0].length;

        // „еднократно концесионно възнаграждение" не е годишното
        if (
          anchor.field === "annual_payment" &&
          anchor.priority === 2 &&
          /(?:еднократн|годишн)\p{L}*\s+$/iu.test(
            text.slice(Math.max(0, aStart - 25), aStart),
          )
        ) {
          continue;
        }

        if (
          SKIP_BEFORE_ANCHOR_RE.test(
            text.slice(Math.max(0, aStart - 40), aStart),
          )
        ) {
          continue;
        }

        const win = windowAfter(text, aEnd);
        const push = (f: Omit<DocFact, "page" | "anchor" | "priority">) => {
          const key = `${f.field}|${page}|${f.offset}`;
          if (seen.has(key)) return;
          seen.add(key);
          facts.push({
            ...f,
            page,
            anchor: anchor.name,
            priority: anchor.priority,
          });
        };

        if (anchor.field === "term" || anchor.field === "grace_period") {
          const t = TERM_RE.exec(win);
          if (!t) continue;
          const prefix = win.slice(0, t.index);
          if (skipPrefix(prefix) || /(?:^|\s)до\s*$/iu.test(prefix)) {
            continue;
          }
          const n = Number(t[1]);
          const months = /^мес/iu.test(t[2]!) ? n : n * 12;
          if (months < 1 || months > 1200) continue;
          const start = aEnd + t.index;
          const end = start + t[0].length;
          push({
            field: anchor.field,
            valueRaw: t[0].trim(),
            amount: null,
            currency: null,
            eur: null,
            months,
            percent: null,
            vat: null,
            quote: quoteAround(text, aStart, end),
            offset: start,
          });
          continue;
        }

        // пари: първата сума в прозореца (процент преди нея → дял от приходите)
        const money = moneyMatches(win).find((mm) => !mm.perUnit);
        const pct = PERCENT_RE.exec(win);
        if (
          anchor.field === "annual_payment" &&
          pct &&
          (!money || pct.index < money.start)
        ) {
          const prefix = win.slice(0, pct.index);
          if (!skipPrefix(prefix)) {
            const start = aEnd + pct.index;
            const end = start + pct[0].length;
            const percent = Number(pct[1]!.replace(",", "."));
            if (percent > 0 && percent <= 100) {
              push({
                field: "payment_percent",
                valueRaw: pct[0].trim(),
                amount: null,
                currency: null,
                eur: null,
                months: null,
                percent,
                vat: null,
                quote: quoteAround(text, aStart, end),
                offset: start,
              });
            }
          }
          continue;
        }
        if (!money) continue;
        const prefix = win.slice(0, money.start);
        if (skipPrefix(prefix)) continue;
        if (
          anchor.field === "annual_payment" &&
          anchor.priority === 2 &&
          !ANNUAL_HINT_RE.test(win.slice(0, money.end + 40))
        ) {
          continue;
        }
        const start = aEnd + money.start;
        const end = aEnd + money.end;
        push({
          field: anchor.field,
          valueRaw: money.raw,
          amount: money.amount,
          currency: money.currency,
          eur: money.eur,
          months: null,
          percent: null,
          vat: money.vat,
          quote: quoteAround(text, aStart, end),
          offset: start,
        });
      }
    }
  });

  return facts.sort(
    (a, b) =>
      a.page - b.page || a.offset - b.offset || a.field.localeCompare(b.field),
  );
}

/** Всяка парична сума в документа, с контекст — „всички цифри" за търсене. */
export function extractDocAmounts(pages: readonly string[]): DocAmount[] {
  const out: DocAmount[] = [];
  pages.forEach((pageRaw, i) => {
    const text = normalizeDocText(pageRaw);
    for (const m of moneyMatches(text)) {
      const a = Math.max(0, m.start - 80);
      const b = Math.min(text.length, m.end + 80);
      out.push({
        raw: m.raw,
        amount: m.amount,
        currency: m.currency,
        eur: m.eur,
        page: i + 1,
        context: `${a > 0 ? "…" : ""}${text.slice(a, b).trim()}${b < text.length ? "…" : ""}`,
        offset: m.start,
      });
    }
  });
  return out;
}

/**
 * Приоритет на документа при избор между няколко: договорът е меродавен,
 * анексите/допълнителните споразумения променят първоначалните стойности,
 * решенията носят прогнозни/минимални стойности.
 */
export function documentRank(title: string | null | undefined): number {
  const t = (title ?? "").toLowerCase();
  if (/анекс|допълнително\s+споразумение|изменени/iu.test(t)) return 3;
  if (/договор/iu.test(t)) return 0;
  if (/решени|заповед/iu.test(t)) return 2;
  return 1;
}
