import { normText } from "./text";

/**
 * Парсер на вградения експорт на НКР (/Concessions/Export?file=csv).
 * Проверено на живо (docs/etl.md): файлът е tab-separated в windows-1251,
 * не CSV/UTF-8. Първият ред е хедър; колона извън хедъра става col_N.
 */
export interface NkrExport {
  headers: string[];
  rows: Array<Record<string, string | null>>;
}

export function decodeWindows1251(bytes: Uint8Array): string {
  return new TextDecoder("windows-1251").decode(bytes);
}

export function parseNkrExport(input: Uint8Array | string): NkrExport {
  const text = typeof input === "string" ? input : decodeWindows1251(input);
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const first = lines[0];
  if (!first) return { headers: [], rows: [] };

  const headers = first.split("\t").map((h) => normText(h));
  const rows: Array<Record<string, string | null>> = [];

  for (const line of lines.slice(1)) {
    const cells = line.split("\t");
    const row: Record<string, string | null> = {};
    cells.forEach((cell, i) => {
      const key = headers[i] || `col_${i}`;
      row[key] = normText(cell) || null;
    });
    rows.push(row);
  }
  return { headers, rows };
}
