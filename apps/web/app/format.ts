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
  return (
    new Intl.NumberFormat("bg-BG", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 2,
    }).format(ratio * 100) + "%"
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
