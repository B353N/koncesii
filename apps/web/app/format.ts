/** Форматиране за интерфейса: български локал, табулярни числа в mono. */

export function fmtEur(value: number | null | undefined): string {
  if (value == null) return "—";
  return (
    new Intl.NumberFormat("bg-BG", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value) + " €"
  );
}

export function fmtMonths(months: number | null | undefined): string {
  if (months == null) return "—";
  if (months % 12 === 0) return `${months} мес. (${months / 12} г.)`;
  return `${months} мес.`;
}

export function fmtPercent(ratio: number): string {
  const pct = ratio * 100;
  return (
    new Intl.NumberFormat("bg-BG", {
      minimumFractionDigits: 1,
      // малките съотношения (0,003%) не бива да се закръглят до 0,0%
      maximumFractionDigits: pct > 0 && pct < 0.1 ? 4 : 2,
    }).format(pct) + "%"
  );
}

export const KIND_LABELS: Record<string, string> = {
  dam: "Язовир",
  beach: "Морски плаж",
  mining: "Добив",
  quarry: "Кариера",
  mineral_water: "Минерална вода",
  port: "Пристанище",
  infrastructure: "Инфраструктура",
  property: "Имот",
  service: "Услуга",
  other: "Друго",
};

/** Заглавия на страниците по вид обект (/concessions/vid/:kind). */
export const KIND_PAGE_TITLES: Record<string, string> = {
  dam: "Концесии за язовири",
  beach: "Концесии за морски плажове",
  mining: "Концесии за добив на подземни богатства",
  quarry: "Концесии за кариери",
  mineral_water: "Концесии за минерална вода",
  port: "Концесии за пристанища",
  infrastructure: "Концесии за инфраструктура",
  property: "Концесии за имоти",
  service: "Концесии за услуги",
  other: "Други концесии",
};

/** Уводно изречение на страницата по вид: какво е обектът, без оценки. */
export const KIND_PAGE_INTROS: Record<string, string> = {
  dam: "Язовири, водоеми и микроязовири, отдадени под концесия от общините и държавата: кой ги стопанисва, за колко години и срещу какво възнаграждение.",
  beach:
    "Морските плажове по Черноморието, отдадени под концесия от Министерския съвет и министъра на туризма: концесионер, срок и годишно възнаграждение по регистъра.",
  mining:
    "Находища на подземни богатства (руди, въглища, нефт и газ, строителни и скалнооблицовъчни материали) с концесия за добив по Закона за подземните богатства.",
  quarry:
    "Кариери за инертни и строителни материали, отдадени под концесия за добив: находище, концесионер, срок и възнаграждение.",
  mineral_water:
    "Находища на минерална вода, отдадени под концесия за добив: сондажи, концесионери, срокове и възнаграждения по регистъра.",
  port: "Пристанищни терминали и пристанища за обществен транспорт, отдадени под концесия: оператор, срок и възнаграждение.",
  infrastructure:
    "Пътна, паркинг и друга инфраструктура, изградена или стопанисвана под концесия: обект, концесионер, срок и възнаграждение.",
  property:
    "Имоти публична държавна и общинска собственост, отдадени под концесия за ползване или строителство.",
  service:
    "Концесии за услуги: стопанисване и експлоатация на публични обекти срещу възнаграждение, по регистрите на общините и държавата.",
  other:
    "Концесии, чийто обект не попада в останалите категории по описанието в регистъра.",
};

export const CONCESSION_KIND_LABELS: Record<string, string> = {
  construction: "за строителство",
  services: "за услуги",
  use: "за ползване",
  other: "друга",
};

export const SEVERITY_LABELS: Record<string, string> = {
  high: "висока",
  medium: "средна",
  low: "ниска",
};

export const FLAG_DESCRIPTIONS: Record<string, string> = {
  LOW_PAYMENT: "годишното възнаграждение е под 1% от стойността",
  LONG_TERM: "срок от 25 или повече години",
  GRACE_PERIOD: "гратисен период от 24 или повече месеца",
  NO_INDEXATION: "липсва клауза за индексация при дълъг срок",
  SINGLE_BIDDER: "един участник в процедурата",
  YOUNG_COMPANY: "концесионерът е регистриран малко преди решението",
  MISSING_MONEY: "не е вписано никакво възнаграждение",
  DATA_CONFLICT: "противоречиви стойности между източниците",
};

/**
 * Условието на всеки индикатор, дословно по docs/red-flags.md. Показва се
 * на партидата, за да е ясно какво точно е проверено - флагът е факт, не
 * твърдение за нарушение.
 */
export const FLAG_CONDITIONS: Record<string, string> = {
  LOW_PAYMENT:
    "годишно възнаграждение / стойност на концесията под 1%, при налични и двете стойности",
  LONG_TERM:
    "срок 300 месеца (25 г.) или повече; отделно ниво при 420 месеца (35 г.)",
  GRACE_PERIOD: "гратисен период 24 месеца или повече",
  NO_INDEXATION:
    "липсва клауза за индексация при срок 120 месеца (10 г.) или повече",
  SINGLE_BIDDER: "един участник в процедурата, където броят е публикуван",
  YOUNG_COMPANY: "концесионерът е регистриран под 12 месеца преди решението",
  MISSING_MONEY: "не е вписано нито еднократно, нито годишно възнаграждение",
  DATA_CONFLICT:
    "противоречиви стойности между източниците за едно и също поле",
};

/** Фиксираният курс за конвертиране на стойности отпреди еврото. */
export const BGN_EUR_RATE = 1.95583;

/** CSV с UTF-8 BOM (Excel разчита кирилицата коректно). */
export function toCsv(
  headers: string[],
  rows: Array<Array<string | number | null>>,
): string {
  const esc = (v: string | number | null): string => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const lines = [
    headers.map(esc).join(","),
    ...rows.map((r) => r.map(esc).join(",")),
  ];
  return "﻿" + lines.join("\n") + "\n";
}

export function csvResponse(filename: string, csv: string): Response {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

/** Полетата, извличани от текста на документите (docs/document-extraction.md). */
export const FACT_LABELS: Record<string, string> = {
  term: "Срок",
  annual_payment: "Годишно възнаграждение",
  onetime_payment: "Еднократно възнаграждение",
  value: "Стойност на концесията",
  grace_period: "Гратисен период",
  payment_percent: "Възнаграждение като дял от приходите",
};

/** Редът на показване: срок и пари отпред, както в паспорта на партидата. */
export const FACT_ORDER = [
  "term",
  "value",
  "annual_payment",
  "payment_percent",
  "onetime_payment",
  "grace_period",
];

/** Какво е станало с извлечената стойност — дословно за читателя. */
export const FACT_OUTCOMES: Record<string, string> = {
  filled: "попълнено от документа — регистърът няма стойност",
  agrees: "съвпада с регистъра",
  conflict: "разминава се с регистъра — отбелязано, не поправено",
  display: "само от документа",
  alternative: "друг кандидат",
};

/** Извлечената стойност в четим вид: сумата в евро, срокът в месеци. */
export function fmtFact(f: {
  field: string;
  value_eur: number | null;
  term_months: number | null;
  percent: number | null;
  value_raw: string;
}): string {
  if (f.percent != null) return `${f.percent.toLocaleString("bg-BG")}%`;
  if (f.term_months != null) return fmtMonths(f.term_months);
  if (f.value_eur != null) return fmtEur(f.value_eur);
  return f.value_raw;
}

/** „PDF · 2,4 MB · 12 стр. · OCR" — какво е файлът и как е прочетен. */
export function fmtDocumentMeta(d: {
  file_name: string | null;
  url: string;
  size_bytes: number | null;
  page_count: number | null;
  text_method: string | null;
  text_status: string | null;
}): string {
  const ext = /\.([a-z0-9]{2,5})$/i.exec(d.file_name ?? d.url)?.[1];
  const parts: string[] = [];
  if (ext) parts.push(ext.toUpperCase());
  if (d.size_bytes != null) {
    parts.push(
      d.size_bytes >= 1024 * 1024
        ? `${(d.size_bytes / 1024 / 1024).toLocaleString("bg-BG", { maximumFractionDigits: 1 })} MB`
        : `${Math.max(1, Math.round(d.size_bytes / 1024))} KB`,
    );
  }
  if (d.page_count) parts.push(`${d.page_count} стр.`);
  if (d.text_method === "ocr")
    parts.push("сканиран, текстът е разпознат (OCR)");
  if (d.text_method === "mixed") parts.push("част от страниците са с OCR");
  if (d.text_status === "unsupported") parts.push("неподдържан формат");
  if (d.text_status === "empty") parts.push("без разпознаваем текст");
  if (d.text_status === "error") parts.push("текстът не можа да се извлече");
  return parts.join(" · ");
}

/** Тежестта на индикатор като число за сортиране и за цвета на флагчето. */
export const SEVERITY_RANK: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

const QUOTE = '"„“”«»';
const QUOTED = `[${QUOTE}]\\s*([^${QUOTE}]+?)\\s*[${QUOTE}]`;

/**
 * Кратък етикет на обект за списъци и картата: „Находище „Кайметлий",
 * пясъци и чакъли" вместо 250 знака юридически текст. Само съкращава
 * регистровия текст, не добавя нищо; пълното заглавие остава на партидата.
 */
export function shortObjectTitle(title: string): string {
  const t = title.replace(/\s+/gu, " ").trim();
  const deposit = new RegExp(`находище\\s*${QUOTED}`, "iu").exec(t);
  if (deposit) {
    let name = deposit[1]!;
    // някои партиди са изцяло с главни букви
    if (name === name.toUpperCase())
      name = name
        .toLowerCase()
        .replace(/(^|[\s-])\p{L}/gu, (c) => c.toUpperCase());
    const material =
      /материали\s*[-–]\s*([^,]+?)(?:,|\s+от\s+находище)/iu.exec(t) ??
      /изкопаеми\s*[-–]\s*([^,]+?)(?:,|\s+от)/iu.exec(t);
    const head = `Находище „${name}“`;
    return material ? `${head}, ${material[1]!.trim().toLowerCase()}` : head;
  }
  const beach = new RegExp(`морски плаж\\s*${QUOTED}`, "iu").exec(t);
  if (beach) return `Морски плаж „${beach[1]}“`;
  const rest = t
    .replace(/^[КK]онцесия за (добив|ползване|услуга|строителство)?\s*/iu, "")
    .replace(/,\s*област.*$/iu, "");
  const head = rest.charAt(0).toUpperCase() + rest.slice(1);
  if (head.length <= 110) return head;
  const cut = head.slice(0, 110);
  return cut.slice(0, Math.max(60, cut.lastIndexOf(" "))) + "…";
}
