import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normText } from "ingest";

/**
 * Детерминистично гео-кодиране на обектите по „Местонахождение" от
 * обявленията („Област: X, Община: Y, Населено място: с. Z").
 * Газетир: GeoNames (CC BY 4.0), центроиди на населени места/общини —
 * приблизителни локации, обозначени по ниво на съвпадение:
 *   settlement (населено място) → municipality (община) → none.
 * Двусмислие без разрешение по област = без координати (честно).
 */

interface Gazetteer {
  source: string;
  oblasti: Record<string, string[]>;
  settlements: Record<string, Array<[number, number, string]>>;
  municipalities: Record<string, Array<[number, number, string]>>;
}

const GAZETTEER: Gazetteer = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../assets/bg-gazetteer.json",
    ),
    "utf8",
  ),
) as Gazetteer;

export interface Location {
  oblast: string | null;
  municipality: string | null;
  place: string | null;
}

const FIELD_RE =
  /област[:\s]+([^,;]+)|община[:\s]+([^,;]+)|населено\s+място[:\s]+([^,;]+)/giu;

/** „Област: Бургас, Община: Несебър, Населено място: гр. Обзор, …" */
export function parseLocation(raw: unknown): Location {
  const text = normText(raw);
  const loc: Location = { oblast: null, municipality: null, place: null };
  if (!text) return loc;
  for (const m of text.matchAll(FIELD_RE)) {
    if (m[1] && !loc.oblast) loc.oblast = normText(m[1]);
    if (m[2] && !loc.municipality) loc.municipality = normText(m[2]);
    if (m[3] && !loc.place) loc.place = normText(m[3]);
  }
  return loc;
}

function stripPlacePrefix(place: string): string {
  return place
    .toLowerCase()
    .replace(/^(гр|с|село|град|к\.?к)[.\s]+/u, "")
    .trim();
}

function adm1For(oblast: string | null): string | null {
  if (!oblast) return null;
  const needle = oblast.toLowerCase();
  for (const [code, names] of Object.entries(GAZETTEER.oblasti)) {
    if (names.includes(needle)) return code;
  }
  return null;
}

export interface GeoMatch {
  lat: number;
  lon: number;
  /** ниво на съвпадение — показва се в интерфейса като „приблизително" */
  precision: "settlement" | "municipality";
}

export function geocode(loc: Location): GeoMatch | null {
  const adm1 = adm1For(loc.oblast);

  if (loc.place) {
    const key = stripPlacePrefix(loc.place);
    const candidates = GAZETTEER.settlements[key] ?? [];
    const filtered = adm1
      ? candidates.filter((c) => c[2] === adm1)
      : candidates;
    if (filtered.length === 1) {
      return {
        lat: filtered[0]![0],
        lon: filtered[0]![1],
        precision: "settlement",
      };
    }
  }

  if (loc.municipality) {
    const key = loc.municipality.toLowerCase().replace(/^община\s+/u, "");
    const candidates = GAZETTEER.municipalities[key] ?? [];
    const filtered = adm1
      ? candidates.filter((c) => c[2] === adm1)
      : candidates;
    if (filtered.length === 1) {
      return {
        lat: filtered[0]![0],
        lon: filtered[0]![1],
        precision: "municipality",
      };
    }
  }

  return null;
}
