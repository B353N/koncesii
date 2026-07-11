import { createHash } from "node:crypto";

/**
 * Agent skill "koncesii-data": документация за агенти как да четат данните
 * на сайта. Съдържанието е константа, за да е digest-ът в
 * /.well-known/agent-skills/index.json винаги верен (Agent Skills
 * Discovery RFC v0.2.0 изисква sha256 на артефакта).
 */

export const SKILL_NAME = "koncesii-data";

export const SKILL_MD = `---
name: koncesii-data
description: Query Bulgaria's public concession registry on koncesii.com - CSV/JSON/GeoJSON endpoints, risk indicator semantics, data quality flags and provenance rules.
---

# koncesii-data

koncesii.com is a transparency platform for concessions in Bulgaria. All data
is public registry information (НКР - the national concession register, and
municipal registers on data.egov.bg). Everything is read-only and requires no
authentication. Data values are in Bulgarian.

## Endpoints

Machine-readable spec: https://koncesii.com/openapi.json

| Endpoint | What it returns |
| --- | --- |
| \`GET /concessions.csv\` | all concessions; filters: \`kind\`, \`status\`, \`flagged=1\`, \`q\` |
| \`GET /concessions/{regNum}/json\` | full record of one concession incl. sources |
| \`GET /grantors.csv\` | granting authorities with concession counts |
| \`GET /companies.csv\` | concessionaire companies keyed by ЕИК |
| \`GET /flags.csv\` | concessions with risk indicators; filter: \`code\` |
| \`GET /map.geojson\` | approximate centroids of concession objects |
| \`GET /healthz\` | service status and the data snapshot date |

HTML pages also answer \`Accept: text/markdown\` with a markdown rendering.

## Semantics you must respect

- **ЕИК is the company join key** (9 or 13 digits, the Bulgarian national
  company identifier). Use it to join against external datasets.
- **Risk indicators are arithmetic facts, not accusations.** Each flag code
  (LOW_PAYMENT, LONG_TERM, GRACE_PERIOD, NO_INDEXATION, SINGLE_BIDDER,
  YOUNG_COMPANY, MISSING_MONEY, DATA_CONFLICT) is a reproducible computation
  documented at https://koncesii.com/methodology. Do not present a flag as
  evidence of wrongdoing.
- **Data quality flags:** every monetary/term value carries the original
  registry string (\`*_raw\`), a normalized EUR value (\`*_eur\`, fixed rate
  1.95583 BGN/EUR for pre-euro values) and a quality flag (\`*_flag\`:
  ok / missing / parsed_from_text / contradictory). The source registries
  contain contradictions; they are recorded and flagged, never silently
  resolved. Treat \`contradictory\` values accordingly.
- **Provenance:** every record links its source URL (НКР партида or
  data.egov.bg resource). Cite it when you present a number.

## Etiquette

Keep request rates modest (the site is a small public-interest service).
Prefer the CSV exports over crawling HTML pages.
`;

export const SKILL_DIGEST =
  "sha256:" + createHash("sha256").update(SKILL_MD, "utf8").digest("hex");
