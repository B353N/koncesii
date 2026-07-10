-- 0000_init.sql — каноничната дефиниция на схемата (docs/core-scope.md обяснява
-- какво означават колоните; docs/etl.md — staging слоя; docs/red-flags.md — флаговете).
--
-- Конвенции:
--   * Всички domain PK са текстови с префикс на типа (docs/core-scope.md):
--     concessions 'k:' / 'k:old:', grantors 'gr:', concessionaires 'eik:' или 'name:',
--     objects 'obj:', procedures 'p:', flags 'flag:'.
--   * Парснати стойности се пазят И сурови (`*_raw`), И нормализирани, с `*_flag`
--     за качеството: 'ok' / 'parsed_from_text' / 'missing' / 'contradictory'.
--     Оригиналът никога не се презаписва.
--   * `*_eur` е нормализираната стойност за сравнения/агрегати; стойности отпреди
--     еврото се конвертират по фиксирания курс 1.95583 BGN/EUR.

PRAGMA foreign_keys = ON;

------------------------------------------------------------------------------
-- STAGING: парснати записи 1:1 с източника (docs/etl.md).
-- `source` носи префикса по конвенцията:
--   'nkr:export:YYYY-MM-DD' | 'nkr:assigned:{guid}:YYYY-MM-DD'
--   | 'nkrold:{sp}:YYYY-MM-DD' | 'egov:{resource_uri}:vN'
------------------------------------------------------------------------------

-- Ред от НКР TSV експорта (windows-1251 → utf-8 при парсване).
CREATE TABLE raw_nkr_export (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT NOT NULL,
  reg_num     TEXT NOT NULL,            -- номер на партида (естествен ключ)
  payload     TEXT NOT NULL,            -- JSON: всички колони на реда, както са
  fetched_at  TEXT NOT NULL
);
CREATE INDEX idx_raw_nkr_export_reg ON raw_nkr_export (reg_num);

-- Парснато обявление за възложена концесия (Раздел I–XI).
CREATE TABLE raw_nkr_announcements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT NOT NULL,
  guid        TEXT NOT NULL,            -- GUID на партидата в НКР
  reg_num     TEXT,
  payload     TEXT NOT NULL,            -- JSON: секции/подточки, плоски
  fetched_at  TEXT NOT NULL
);
CREATE INDEX idx_raw_nkr_ann_guid ON raw_nkr_announcements (guid);

-- Запис от стария регистър (nkrold, последователни sp номера).
CREATE TABLE raw_old_concessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT NOT NULL,
  sp          INTEGER NOT NULL,         -- ?sp=N от Tapestry URL-а
  payload     TEXT NOT NULL,
  fetched_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_raw_old_sp ON raw_old_concessions (sp, source);

-- Ред от общински регистър на data.egov.bg (след хедър-нормализация).
CREATE TABLE raw_egov_rows (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  source       TEXT NOT NULL,
  resource_uri TEXT NOT NULL,
  row_index    INTEGER NOT NULL,
  payload      TEXT NOT NULL,           -- JSON: normalized header → стойност
  fetched_at   TEXT NOT NULL
);
CREATE INDEX idx_raw_egov_resource ON raw_egov_rows (resource_uri);

------------------------------------------------------------------------------
-- DOMAIN: единният модел (docs/core-scope.md).
------------------------------------------------------------------------------

CREATE TABLE grantors (
  id                TEXT PRIMARY KEY,   -- 'gr:' + slug на органа
  name              TEXT NOT NULL,
  normalized_name   TEXT NOT NULL UNIQUE,
  kind              TEXT NOT NULL CHECK (kind IN ('minister', 'municipality', 'other')),
  municipality_code TEXT,               -- ЕКАТТЕ/код на общината, където е приложимо
  source_url        TEXT
);

CREATE TABLE concessionaires (
  id              TEXT PRIMARY KEY,     -- 'eik:' + ЕИК при валиден, иначе 'name:' + норм. име
  eik             TEXT,                 -- 9 или 13 цифри; NULL при невалиден/липсващ
  name            TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  address         TEXT,
  source_url      TEXT
);
CREATE UNIQUE INDEX idx_concessionaires_eik ON concessionaires (eik) WHERE eik IS NOT NULL;
CREATE INDEX idx_concessionaires_name ON concessionaires (normalized_name);

CREATE TABLE procedures (
  id                TEXT PRIMARY KEY,   -- 'p:' + НКР номер на процедура (121-…, 122-…)
  number            TEXT NOT NULL UNIQUE,
  kind              TEXT,               -- вид процедура, както е в източника
  criteria          TEXT,               -- JSON: критерии за възлагане с тежести
  bidder_count      INTEGER,            -- брой участници (където е публикуван)
  bidder_count_flag TEXT NOT NULL DEFAULT 'missing'
                    CHECK (bidder_count_flag IN ('ok', 'parsed_from_text', 'missing', 'contradictory')),
  source_url        TEXT
);

CREATE TABLE concessions (
  id                   TEXT PRIMARY KEY, -- 'k:' + НКР рег. номер, 'k:old:' + номер за стария регистър
  reg_num              TEXT NOT NULL UNIQUE, -- номер на партида: O-000123, D-…, 221-…/дата
  title                TEXT NOT NULL,
  kind                 TEXT CHECK (kind IN ('construction', 'services', 'use', 'other')),
  status               TEXT,
  grantor_id           TEXT REFERENCES grantors (id),
  concessionaire_id    TEXT REFERENCES concessionaires (id),
  procedure_id         TEXT REFERENCES procedures (id),

  -- срок: нормализиран в месеци; „420 месеца" и „35 години" дават 420
  start_date           TEXT,
  term_raw             TEXT,
  term_months          INTEGER,
  term_flag            TEXT NOT NULL DEFAULT 'missing'
                       CHECK (term_flag IN ('ok', 'parsed_from_text', 'missing', 'contradictory')),
  extensions_raw       TEXT,             -- допустими удължавания, свободен текст

  -- пари: сурово + EUR + флаг за всяко поле; оригиналът не се пипа
  value_raw            TEXT,
  value_eur            REAL,
  value_flag           TEXT NOT NULL DEFAULT 'missing'
                       CHECK (value_flag IN ('ok', 'parsed_from_text', 'missing', 'contradictory')),
  onetime_payment_raw  TEXT,
  onetime_payment_eur  REAL,
  onetime_payment_flag TEXT NOT NULL DEFAULT 'missing'
                       CHECK (onetime_payment_flag IN ('ok', 'parsed_from_text', 'missing', 'contradictory')),
  annual_payment_raw   TEXT,
  annual_payment_eur   REAL,
  annual_payment_flag  TEXT NOT NULL DEFAULT 'missing'
                       CHECK (annual_payment_flag IN ('ok', 'parsed_from_text', 'missing', 'contradictory')),
  grace_period_months  INTEGER,
  grace_period_raw     TEXT,
  indexation_raw       TEXT,             -- клауза за индексация, свободен текст
  has_indexation       INTEGER,          -- 0/1/NULL(неизвестно)

  -- произход: всяко показано число е проследимо до източника
  source               TEXT NOT NULL CHECK (source IN ('nkr', 'nkrold', 'egov')),
  source_url           TEXT NOT NULL,    -- URL на партидата
  announcement_url     TEXT,
  fetched_at           TEXT NOT NULL
);
CREATE INDEX idx_concessions_grantor ON concessions (grantor_id);
CREATE INDEX idx_concessions_concessionaire ON concessions (concessionaire_id);
CREATE INDEX idx_concessions_status ON concessions (status);

CREATE TABLE objects (
  id            TEXT PRIMARY KEY,       -- 'obj:' + concession id + ':' + пореден
  concession_id TEXT NOT NULL REFERENCES concessions (id),
  seq           INTEGER NOT NULL,
  description   TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN
                  ('dam', 'beach', 'mining', 'quarry', 'mineral_water', 'port',
                   'infrastructure', 'property', 'service', 'other')),
  kind_raw      TEXT,                   -- суровият предмет, от който е класифицирано
  oblast        TEXT,
  municipality  TEXT,
  place         TEXT,
  nuts_code     TEXT,
  cadastre_id   TEXT,
  lat           REAL,                   -- геокодира се в ETL (фаза 4), не на живо
  lon           REAL,
  geo_precision TEXT                    -- 'settlement' | 'municipality' (центроид, приблизително)
);
CREATE INDEX idx_objects_concession ON objects (concession_id);
CREATE INDEX idx_objects_kind ON objects (kind);

CREATE TABLE payments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  concession_id   TEXT NOT NULL REFERENCES concessions (id),
  year            INTEGER,
  contracted_raw  TEXT,
  contracted_eur  REAL,
  contracted_flag TEXT NOT NULL DEFAULT 'missing'
                  CHECK (contracted_flag IN ('ok', 'parsed_from_text', 'missing', 'contradictory')),
  paid_raw        TEXT,                 -- реално отчетено (v2, където има източник)
  paid_eur        REAL,
  paid_flag       TEXT NOT NULL DEFAULT 'missing'
                  CHECK (paid_flag IN ('ok', 'parsed_from_text', 'missing', 'contradictory')),
  source_url      TEXT NOT NULL
);
CREATE INDEX idx_payments_concession ON payments (concession_id);

CREATE TABLE documents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  concession_id TEXT NOT NULL REFERENCES concessions (id),
  title         TEXT,
  kind          TEXT,                   -- обявление / договор / решение / друго, по източника
  url           TEXT NOT NULL,
  published_at  TEXT
);
CREATE INDEX idx_documents_concession ON documents (concession_id);

-- Ръчна опашка за двусмислените dedup случаи (ADR-0003): разминаване източник↔НКР
-- или несигурно свързване. Нищо не се решава мълчаливо.
CREATE TABLE review_queue (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  reason     TEXT NOT NULL,             -- 'ambiguous_match' | 'source_conflict' | …
  payload    TEXT NOT NULL,             -- JSON: кандидатите и полетата в конфликт
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at TEXT NOT NULL
);

------------------------------------------------------------------------------
-- DERIVED: изчислява се в ETL derive стъпката, никога на живо (docs/red-flags.md).
------------------------------------------------------------------------------

CREATE TABLE flags (
  id            TEXT PRIMARY KEY,       -- 'flag:' + concession id + ':' + код
  concession_id TEXT NOT NULL REFERENCES concessions (id),
  code          TEXT NOT NULL,          -- LOW_PAYMENT / LONG_TERM / … (docs/red-flags.md)
  severity      TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  inputs        TEXT NOT NULL,          -- JSON: формулата и входните числа, както се показват
  computed_at   TEXT NOT NULL
);
CREATE INDEX idx_flags_concession ON flags (concession_id);
CREATE INDEX idx_flags_code ON flags (code);

-- Precompute агрегати за начало/списъци (обобщения, топ списъци и т.н.).
CREATE TABLE rollups (
  key         TEXT PRIMARY KEY,
  payload     TEXT NOT NULL,            -- JSON
  computed_at TEXT NOT NULL
);
