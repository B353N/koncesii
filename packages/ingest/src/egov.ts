import { normText } from "./text";
import { parseMoney } from "./money";
import { extractEik } from "./eik";

/**
 * Нормализатор на общинските „Регистър на концесиите" набори от data.egov.bg.
 * Порт на normalize стъпката от tools/harvest/egov_concessions_harvest.py:
 * HEADER_MAP евристиките, extract_rows обхождането и отчетът за
 * неразпознати хедъри. Общинските CSV-та имат творчески хедъри („Регестър…");
 * неразпознатите се докладват и разширяват мапинга през PR (docs/etl.md).
 */

// Канонични полета и евристики за разпознаване на хедъри (РМС 436/2017).
export const HEADER_MAP: ReadonlyArray<readonly [string, RegExp]> = [
  // NFKC превръща „№" в „No", затова хващаме и двете форми.
  ["row_number", /^№|^no\b|номер по ред|пореден/iu],
  ["concession_id", /идентификац|номер на концеси|партиден/iu],
  ["decision", /решение|заповед|рмс/iu],
  ["subject", /предмет/iu],
  [
    "object_description",
    /индивидуализация|обект на концеси|описание на обект|местонахожд/iu,
  ],
  ["concessionaire", /концесионер/iu],
  ["eik", /еик|булстат/iu],
  ["term", /срок/iu],
  ["payment", /възнаграждение|плащане|концесионно/iu],
  ["contract_date", /дата на скл|сключване|договор от|дата на договор/iu],
  ["termination", /прекрат/iu],
  ["status", /статус|състояние/iu],
];

export interface HeaderMapping {
  /** индекс на колона → канонично поле */
  mapping: Map<number, string>;
  unmapped: string[];
}

export function mapHeaders(headers: string[]): HeaderMapping {
  const mapping = new Map<number, string>();
  const unmapped: string[] = [];
  const taken = new Set<string>();

  headers.forEach((h, i) => {
    const hn = normText(h).toLowerCase();
    if (!hn) return;
    const hit = HEADER_MAP.find(([, re]) => re.test(hn));
    if (hit) {
      // първото съвпадение печели; не презаписваме вече заето поле
      if (!taken.has(hit[0])) {
        mapping.set(i, hit[0]);
        taken.add(hit[0]);
      }
    } else {
      unmapped.push(h);
    }
  });
  return { mapping, unmapped };
}

/**
 * Намира табличните данни в отговора на getResourceData, независимо как
 * точно е вложен масивът (data.rows / data / csvData …).
 */
export function extractRows(payload: unknown): unknown[][] {
  const walk = (node: unknown): unknown[][] | null => {
    if (Array.isArray(node)) {
      if (node.length > 0 && node.every((r) => Array.isArray(r))) {
        return node as unknown[][];
      }
      for (const item of node) {
        const got = walk(item);
        if (got) return got;
      }
    } else if (node && typeof node === "object") {
      for (const v of Object.values(node)) {
        const got = walk(v);
        if (got) return got;
      }
    }
    return null;
  };
  return walk(payload) ?? [];
}

export interface EgovDatasetMeta {
  uri?: string;
  name?: string;
  source?: string;
  updated_at?: string;
}

export interface EgovRecord {
  source: "data.egov.bg";
  dataset_uri: string | null;
  dataset_name: string | null;
  resource_uri: string;
  /** концедентът (общината/органът, публикувал набора) */
  grantor: string | null;
  updated_at: string | null;
  [field: string]: string | number | null;
}

export interface NormalizedResource {
  records: EgovRecord[];
  unmapped: string[];
}

export function normalizeResource(
  payload: unknown,
  dataset: EgovDatasetMeta,
  resourceUri: string,
): NormalizedResource {
  const rows = extractRows(payload);
  if (rows.length < 2) return { records: [], unmapped: [] };

  // първият непразен ред приемаме за хедър
  const headerIdx = rows.findIndex((r) => r.some((c) => normText(c)));
  if (headerIdx === -1) return { records: [], unmapped: [] };
  const headers = (rows[headerIdx] ?? []).map((c) => normText(c));
  const { mapping, unmapped } = mapHeaders(headers);
  if (mapping.size === 0) return { records: [], unmapped };

  const grantor = normText(dataset.source || dataset.name) || null;
  const records: EgovRecord[] = [];

  for (const r of rows.slice(headerIdx + 1)) {
    if (!r.some((c) => normText(c))) continue;
    const rec: EgovRecord = {
      source: "data.egov.bg",
      dataset_uri: dataset.uri ?? null,
      dataset_name: normText(dataset.name) || null,
      resource_uri: resourceUri,
      grantor,
      updated_at: dataset.updated_at ?? null,
    };
    for (const [idx, field] of mapping) {
      if (idx < r.length) rec[field] = normText(r[idx]) || null;
    }
    if (typeof rec["payment"] === "string") {
      const p = parseMoney(rec["payment"]);
      rec["payment_raw"] = p.raw;
      rec["payment_value"] = p.value;
      rec["payment_currency"] = p.currency;
      rec["payment_eur"] = p.eur;
      rec["payment_flag"] = p.flag;
    }
    // ЕИК от свободния текст на концесионера, ако липсва колона
    if (!rec["eik"] && typeof rec["concessionaire"] === "string") {
      rec["eik"] = extractEik(rec["concessionaire"]);
    }
    records.push(rec);
  }

  return { records, unmapped };
}
