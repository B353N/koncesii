/**
 * Resource route: /openapi.json — OpenAPI 3.1 описание на публичните
 * данни endpoint-и. Само каквото реално съществува: CSV експортите,
 * JSON на партида, GeoJSON за картата и healthz. Всичко е публично,
 * без автентикация; данните са на български.
 */

const BASE = "https://koncesii.com";

const CSV_RESPONSE = {
  "200": {
    description: "CSV (UTF-8 с BOM), първият ред е хедър на български",
    content: { "text/csv": { schema: { type: "string" } } },
  },
} as const;

const SPEC = {
  openapi: "3.1.0",
  info: {
    title: "КОНЦЕСИИ — публични данни",
    version: "1.0.0",
    description:
      "Read-only data endpoints of koncesii.com, the transparency platform " +
      "for concessions in Bulgaria. All data is public registry information " +
      "(НКР, data.egov.bg); every value is traceable to its source URL. " +
      "Data values are in Bulgarian. No authentication. Please keep request " +
      "rates modest.",
    contact: { url: "https://github.com/B353N/koncesii" },
  },
  servers: [{ url: BASE }],
  paths: {
    "/concessions.csv": {
      get: {
        summary: "Всички концесии като CSV (с филтрите на списъка)",
        parameters: [
          {
            name: "kind",
            in: "query",
            description:
              "вид обект: dam, beach, mining, quarry, mineral_water, port, infrastructure, property, service, other",
            schema: { type: "string" },
          },
          { name: "status", in: "query", schema: { type: "string" } },
          {
            name: "flagged",
            in: "query",
            description: "1 = само концесии с индикатор за риск",
            schema: { type: "string", enum: ["1"] },
          },
          {
            name: "q",
            in: "query",
            description: "търсене по обект, партида, концесионер, ЕИК",
            schema: { type: "string" },
          },
        ],
        responses: CSV_RESPONSE,
      },
    },
    "/concessions/{regNum}/json": {
      get: {
        summary:
          "Пълните данни на една концесия: стойности с флагове за качество, обекти, документи, плащания, индикатори и източници",
        parameters: [
          {
            name: "regNum",
            in: "path",
            required: true,
            description: "партиден номер от НКР, напр. O-000123",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description:
              "Концесията; всяко парично поле носи *_raw (оригинала), *_eur (нормализирано, BGN→EUR по 1.95583) и *_flag (качество: ok/missing/parsed_from_text/contradictory)",
            content: { "application/json": { schema: { type: "object" } } },
          },
          "404": { description: "Няма партида с този номер" },
        },
      },
    },
    "/grantors.csv": {
      get: {
        summary: "Концеденти (органи) с брой концесии и индикатори",
        responses: CSV_RESPONSE,
      },
    },
    "/companies.csv": {
      get: {
        summary: "Концесионери (компании по ЕИК) с брой концесии",
        responses: CSV_RESPONSE,
      },
    },
    "/flags.csv": {
      get: {
        summary: "Концесии с индикатори за риск",
        parameters: [
          {
            name: "code",
            in: "query",
            description:
              "филтър по код: LOW_PAYMENT, LONG_TERM, GRACE_PERIOD, NO_INDEXATION, SINGLE_BIDDER, YOUNG_COMPANY, MISSING_MONEY, DATA_CONFLICT",
            schema: { type: "string" },
          },
        ],
        responses: CSV_RESPONSE,
      },
    },
    "/map.geojson": {
      get: {
        summary: "Геокодирани обекти на концесии (приблизителни центроиди)",
        responses: {
          "200": {
            description: "GeoJSON FeatureCollection",
            content: { "application/geo+json": { schema: { type: "object" } } },
          },
        },
      },
    },
    "/healthz": {
      get: {
        summary: "Състояние на услугата и дата на данните",
        responses: {
          "200": {
            description: '{"status":"ok","data_date":"YYYY-MM-DD"}',
            content: { "application/json": { schema: { type: "object" } } },
          },
        },
      },
    },
  },
} as const;

export function loader() {
  return new Response(JSON.stringify(SPEC, null, 2) + "\n", {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
