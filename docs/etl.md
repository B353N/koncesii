# ETL pipeline и източници

Как КОНЦЕСИИ извлича, нормализира и опреснява данните. За архитектурата —
[`architecture.md`](architecture.md); за доменния модел — [`core-scope.md`](core-scope.md).

> **Проверено на живо (07.2026):** числата и форматите по-долу са свалени и валидирани от
> реалните регистри, не са предположения.

## Източници

### 1. НКР — nkr.government.bg (основен)

- **Обем:** 1434 концесии + 222 процедури (без филтри), регистърът е жив (нови партиди
  седмично).
- **Индекс:** `GET /Concessions/Export?file=csv` връща целия регистър в **една заявка** —
  внимание: файлът е **tab-separated в windows-1251** (~1465 реда / ~512 KB), не CSV/UTF-8.
  Алтернатива: `GET /Concessions/Search?page=N&rowsPerPage=100` (AJAX, HTML фрагмент);
  GUID-ът на партидата е в скритата колона `td.IdColumn`.
- **Партида:** `GET /ConcessionaireProcedures/ConcessionaireProcedureInfo/{guid}` — съдържа
  линковете към обявленията (`/Preview/AssignedConcession/{guid}`,
  `/Preview/ConcessionProcedure/{guid}`) и документите (`/File/Download/{guid}`).
- **Обявление (структурираните данни):** HTML със стабилна структура
  `.concession-assignment > .section-content` (Раздел I–XI) `> .form-group`, с номерирани
  подточки (9.6.1, 9.12.2 …) като плосък текст. Парсерът е в
  `tools/harvest/nkr_scraper.py` (bootstrap) и `packages/ingest` (инкрементално).
- **Ограничения:** сайтът **блокира datacenter IP-та** (TLS reset). Извличането върви само от
  BG residential/office IP. Учтивост: 1 заявка/сек.

### 2. Стар НКР — nkrold.government.bg (история преди 2018)

Tapestry приложение с последователни числови ID-та
(`?service=external/ConcessionPrint&sp=N`) — обхожда се изчерпателно. Тук е историята на
минните и плажните концесии отпреди ЗК 2018. Схемата е различна; зарежда се в отделни
`raw_old_*` staging таблици и се дедупликира по [ADR-0003](adr/0003-nkr-wins-dedup.md).

### 3. data.egov.bg — официалното Open Data API (допълващ)

- JSON-over-POST: `POST https://data.egov.bg/api/{method}`, `api_key` **незадължителен** за
  read методите, лимит 60 заявки/мин на IP. Ключови методи: `listDatasets` (търсене по
  keywords/тагове), `getResourceData` (връща парснатото съдържание като JSON).
- ~99+ общински „Регистър на концесиите" набора (таг 762 „концесии" + таг 3028
  „РМС 436/2017"), разнородни схеми — нормализират се с хедър-евристиките в
  `tools/harvest/egov_concessions_harvest.py`.
- Регистърът на **МЕ за добив на подземни богатства** също е тук (org 105).
- Порталът също реже чужди/datacenter IP-та (403 на ниво Apache).

### 4. Министерство на енергетиката и Министерство на туризма (обогатяващи)

МЕ: концесии за добив + публикувани плащания по находища. МТ: морските плажове. Формати:
таблици/файлове по страниците на министерствата; влизат след v1.0 (виж плана).

### 5. Отчети за изпълнение (v2)

Годишните отчети на концедентите (чл. 45/чл. 132 ЗК) и докладите на АППК носят
„реално платено" срещу „договорено" — но са PDF-и на парче. Планирани за v2 с
PDF extraction опашка.

## Двустепенното извличане ([ADR-0002](adr/0002-two-stage-ingest.md))

```
Стъпка A (bootstrap, ръчна, BG IP):
  tools/harvest/nkr_scraper.py all          → nkr_data/   (сурови HTML + parsed JSON)
  tools/harvest/egov_concessions_harvest.py → data/       (сурови JSON + normalized JSONL)
  tools/harvest/upload_to_r2.py             → R2 bucket koncesii-raw/YYYY-MM-DD/…

Стъпка B (инкрементално, koncesii-etl Worker, cron):
  1. fetch НКР export (една заявка) през BG proxy → diff срещу последния snapshot
  2. за нови/променени партиди: свали партида + обявления → R2 → парсни → staging
  3. data.egov.bg: listDatasets по таговете → обнови променените ресурси
  4. normalize → unify (dedup) → derive flags → precompute rollups → D1
  5. integrity gate: hard asserts върху тоталите преди подмяна (по модела на СИГМА)
```

Суровите файлове са immutable в R2 с датиран префикс — всяка версия на сайта е
възпроизводима от суровината. **Сурови данни не се комитват в git.**

## Staging конвенция

Всеки staging ред носи `source` префикс, по модела на СИГМА:

| Източник                  | `source` префикс                  |
| ------------------------- | ---------------------------------- |
| НКР експорт               | `nkr:export:YYYY-MM-DD`            |
| НКР обявление             | `nkr:assigned:{guid}:YYYY-MM-DD`   |
| Стар регистър             | `nkrold:{sp}:YYYY-MM-DD`           |
| data.egov.bg ресурс       | `egov:{resource_uri}:vN`           |

## Качество на данните — известни проблеми

- „Няма въведени данни" е валидна и честа стойност — пази се като `NULL` + флаг, не като 0.
- Противоречиви суми (лв./евро двойки след еврото) — `value_flag='contradictory'`, двете се пазят.
- Общинските CSV-та имат творчески хедъри („Регестър…") — неразпознатите отиват в
  `unmapped_headers.json` и разширяват мапинга през PR.
- Старият регистър съдържа партиди, мигрирани и в новия — dedup-ът е задължителна стъпка,
  не оптимизация.
