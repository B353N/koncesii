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
