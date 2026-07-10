import type Database from "better-sqlite3";
import {
  classifyObjectKind,
  extractEik,
  normText,
  parseMoney,
  parseTerm,
} from "ingest";
import type { StagedLot } from "./staging";

/**
 * Unify: staging → единния модел, по правилото „НКР печели" (ADR-0003).
 * НКР е канонично верен за полетата, които носи; data.egov.bg допълва
 * липсващи стойности и никога не презаписва. Разминаване поражда
 * value_flag='contradictory' + запис в review_queue; двете стойности се пазят.
 */

const EXPORT_URL = "https://nkr.government.bg/Concessions/Export?file=csv";
const PARTIDA_URL = (guid: string) =>
  `https://nkr.government.bg/ConcessionaireProcedures/ConcessionaireProcedureInfo/${guid}`;
const EGOV_URL = (resourceUri: string) =>
  `https://data.egov.bg/data/resourceView/${resourceUri}`;

export function normalizeName(name: string): string {
  return normText(name)
    .toLowerCase()
    .replace(/["„“”'«»]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugify(name: string): string {
  return normalizeName(name)
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
}

function grantorKind(name: string): "minister" | "municipality" | "other" {
  if (/община|кмет/iu.test(name)) return "municipality";
  if (/министър|министерств/iu.test(name)) return "minister";
  return "other";
}

function concessionKind(raw: string | null): string | null {
  const t = normText(raw).toLowerCase();
  if (!t) return null;
  if (t.includes("строителств")) return "construction";
  if (t.includes("услуг")) return "services";
  if (t.includes("ползване")) return "use";
  return "other";
}

/**
 * Съответствие: етикет на подточка от обявлението → домейн поле.
 * Етикетите са от реалните формуляри на НКР (проверени на живо, 07.2026):
 * „Дължимо концесионно възнаграждение съгласно сключения концесионен
 * договор" е периодичното (годишно) възнаграждение; „еднократно" се
 * проверява преди общото правило. Редът има значение.
 */
const ITEM_FIELDS: ReadonlyArray<readonly [string, RegExp]> = [
  ["onetime_payment", /еднократно\s+(концесионно\s+)?възнаграждение/iu],
  [
    "annual_payment",
    /годишно\s+(концесионно\s+)?възнаграждение|(дължимо\s+)?концесионно\s+възнаграждение/iu,
  ],
  ["value", /стойност\s+на\s+концесията/iu],
  ["term", /срок\s+на\s+концесията/iu],
  ["grace_period", /гратисен/iu],
  ["indexation", /индексаци/iu],
  ["bidder_count", /брой\s+(на\s+)?(участници|оференти|кандидати)/iu],
];

/** Изменения/промени по договора не са първоначалните стойности. */
const AMENDMENT_RE = /^(изменение|промяна|информация за промени)/iu;

interface AnnouncementFacts {
  [field: string]: string;
}

function factsFromAnnouncement(payload: {
  sections?: Record<
    string,
    { text?: string; items?: Record<string, string | null>; groups?: string[] }
  >;
}): AnnouncementFacts {
  const facts: AnnouncementFacts = {};
  for (const [key, section] of Object.entries(payload.sections ?? {})) {
    for (const [label, value] of Object.entries(section.items ?? {})) {
      if (!value || AMENDMENT_RE.test(label.replace(/^[\d. ]+/, ""))) continue;
      for (const [field, re] of ITEM_FIELDS) {
        if (!re.test(label)) continue;
        // Един етикет храни точно едно поле — първото съвпадение печели
        // (иначе „Еднократно … възнаграждение" пълни и годишното поле).
        if (facts[field] === undefined) {
          // „Конкретен срок … (месеца)": голото число в стойността е в
          // месеци — единицата идва от самия етикет на формуляра.
          if (
            field === "term" &&
            /месец/iu.test(label) &&
            /^\d+([.,]\d+)?$/.test(value.trim())
          ) {
            facts[field] = `${value.trim()} месеца`;
          } else {
            facts[field] = value;
          }
        }
        break;
      }
    }
    // Разделът за концесионера няма номерация: име + ЕИК са във form-groups.
    if (
      /концесионер/iu.test(key) &&
      facts["concessionaire_name"] === undefined
    ) {
      const blob = [...(section.groups ?? []), section.text ?? ""].join(" ");
      const eik = extractEik(blob);
      if (eik) facts["concessionaire_eik"] = eik;
      const name =
        (section.groups ?? []).find(
          (g) => !/^еик|^булстат/iu.test(g.trim()) && !/^\d+$/.test(g.trim()),
        ) ?? "";
      if (normText(name)) facts["concessionaire_name"] = normText(name);
    }
  }
  return facts;
}

/**
 * Набори, които са огледала на самия НКР (общини качват националния регистър
 * като свой набор). НКР го имаме от първа ръка — огледалата се прескачат,
 * детерминистично по името на набора. Броят се отчита в статистиката.
 */
const NKR_MIRROR_RE = /национален концесионен регистър/iu;

interface EgovRow {
  resource_uri: string;
  dataset_name?: string | null;
  concession_id?: string | null;
  subject?: string | null;
  object_description?: string | null;
  concessionaire?: string | null;
  eik?: string | null;
  term?: string | null;
  payment?: string | null;
  payment_raw?: string | null;
  payment_value?: number | null;
  payment_eur?: number | null;
  payment_flag?: string | null;
  contract_date?: string | null;
  grantor?: string | null;
  status?: string | null;
  row_number?: string | null;
}

export interface UnifyStats {
  concessions: number;
  fromNkr: number;
  fromEgov: number;
  supplemented: number;
  conflicts: number;
  mirrorsSkipped: number;
}

export function unify(
  db: Database.Database,
  lots: StagedLot[],
  date: string,
): UnifyStats {
  const stats: UnifyStats = {
    concessions: 0,
    fromNkr: 0,
    fromEgov: 0,
    supplemented: 0,
    conflicts: 0,
    mirrorsSkipped: 0,
  };

  const insGrantor = db.prepare(
    `INSERT OR IGNORE INTO grantors (id, name, normalized_name, kind, source_url)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const insConcessionaire = db.prepare(
    `INSERT OR IGNORE INTO concessionaires (id, eik, name, normalized_name, source_url)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const insConcession = db.prepare(
    `INSERT INTO concessions (id, reg_num, title, kind, status, grantor_id, concessionaire_id,
       term_raw, term_months, term_flag,
       value_raw, value_eur, value_flag,
       onetime_payment_raw, onetime_payment_eur, onetime_payment_flag,
       annual_payment_raw, annual_payment_eur, annual_payment_flag,
       grace_period_months, grace_period_raw, indexation_raw, has_indexation,
       source, source_url, announcement_url, fetched_at)
     VALUES (@id, @reg_num, @title, @kind, @status, @grantor_id, @concessionaire_id,
       @term_raw, @term_months, @term_flag,
       @value_raw, @value_eur, @value_flag,
       @onetime_raw, @onetime_eur, @onetime_flag,
       @annual_raw, @annual_eur, @annual_flag,
       @grace_months, @grace_raw, @indexation_raw, @has_indexation,
       @source, @source_url, @announcement_url, @fetched_at)`,
  );
  const insObject = db.prepare(
    `INSERT INTO objects (id, concession_id, seq, description, kind, kind_raw, oblast, municipality, place)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insDocument = db.prepare(
    "INSERT INTO documents (concession_id, title, kind, url) VALUES (?, ?, ?, ?)",
  );
  const insPayment = db.prepare(
    `INSERT INTO payments (concession_id, year, contracted_raw, contracted_eur, contracted_flag, source_url)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insReview = db.prepare(
    "INSERT INTO review_queue (reason, payload, status, created_at) VALUES (?, ?, 'open', ?)",
  );

  const upsertGrantor = (name: string | null): string | null => {
    const n = normText(name);
    if (!n) return null;
    const id = `gr:${slugify(n)}`;
    insGrantor.run(id, n, normalizeName(n), grantorKind(n), null);
    return id;
  };

  const upsertConcessionaire = (
    name: string | null,
    eikRaw: string | null,
    sourceUrl: string,
  ): string | null => {
    const n = normText(name);
    if (!n || /^няма\s/iu.test(n)) return null;
    const eik = extractEik(eikRaw) ?? extractEik(n);
    const id = eik ? `eik:${eik}` : `name:${slugify(n)}`;
    insConcessionaire.run(id, eik, n, normalizeName(n), sourceUrl);
    return id;
  };

  // ── 1. НКР: базата е експортът/индексът, обогатен от обявленията ────────
  const regToLot = new Map<string, StagedLot>();
  const guidToLot = new Map<string, StagedLot>();
  for (const lot of lots) {
    guidToLot.set(lot.guid, lot);
    if (lot.regNum) regToLot.set(lot.regNum, lot);
  }

  const factsByGuid = new Map<string, AnnouncementFacts>();
  const annRows = db
    .prepare<[], { guid: string; payload: string }>(
      "SELECT guid, payload FROM raw_nkr_announcements ORDER BY id",
    )
    .all();
  for (const r of annRows) {
    const payload = JSON.parse(r.payload) as Parameters<
      typeof factsFromAnnouncement
    >[0] & {
      kind?: string | null;
    };
    if (payload.kind && payload.kind !== "AssignedConcession") continue;
    // Партида може да има няколко обявления (вкл. изменения) — сливаме
    // по поле: по-ранният staged документ печели, останалите допълват.
    const existing = factsByGuid.get(r.guid) ?? {};
    factsByGuid.set(r.guid, { ...factsFromAnnouncement(payload), ...existing });
  }

  const exportRows = db
    .prepare<[], { reg_num: string; payload: string }>(
      "SELECT reg_num, payload FROM raw_nkr_export ORDER BY reg_num",
    )
    .all();

  const byEik = new Map<string, string[]>(); // eik → concession ids
  const seenReg = new Set<string>();

  const pick = (
    row: Record<string, string | null>,
    re: RegExp,
  ): string | null => {
    for (const [k, v] of Object.entries(row)) if (re.test(k)) return v;
    return null;
  };

  for (const er of exportRows) {
    if (seenReg.has(er.reg_num)) continue; // dedup в самия експорт
    seenReg.add(er.reg_num);
    const row = JSON.parse(er.payload) as Record<string, string | null>;

    const rowGuid = normText(row["guid"]) || null;
    const lot =
      (rowGuid ? guidToLot.get(rowGuid) : undefined) ??
      regToLot.get(er.reg_num);
    const guid = lot?.guid ?? rowGuid;
    const facts = guid ? (factsByGuid.get(guid) ?? {}) : {};
    const sourceUrl = guid ? PARTIDA_URL(guid) : EXPORT_URL;

    const title =
      normText(pick(row, /наименование|име на концеси/i)) || er.reg_num;
    const grantorId = upsertGrantor(pick(row, /концедент/i));
    // Индексът няма колона за концесионер — той идва от обявлението.
    const concessionaireId = upsertConcessionaire(
      pick(row, /концесионер/i) ?? facts["concessionaire_name"] ?? null,
      pick(row, /^еик|булстат/i) ?? facts["concessionaire_eik"] ?? null,
      sourceUrl,
    );

    const term = parseTerm(facts["term"] ?? pick(row, /срок/i));
    const value = parseMoney(facts["value"]);
    const onetime = parseMoney(facts["onetime_payment"]);
    const annual = parseMoney(facts["annual_payment"]);
    const grace = parseTerm(facts["grace_period"]);
    const indexationRaw = normText(facts["indexation"]) || null;

    const id = `k:${er.reg_num}`;
    insConcession.run({
      id,
      reg_num: er.reg_num,
      title,
      kind: concessionKind(
        pick(row, /предмет/i) ?? pick(row, /вид на концесията/i),
      ),
      status:
        normText(pick(row, /статус на партида|статус|състояние/i)) || null,
      grantor_id: grantorId,
      concessionaire_id: concessionaireId,
      term_raw: term.raw,
      term_months: term.months,
      term_flag: term.flag,
      value_raw: value.raw,
      value_eur: value.eur,
      value_flag: value.flag,
      onetime_raw: onetime.raw,
      onetime_eur: onetime.eur,
      onetime_flag: onetime.flag,
      annual_raw: annual.raw,
      annual_eur: annual.eur,
      annual_flag: annual.flag,
      grace_months: grace.months,
      grace_raw: grace.raw,
      indexation_raw: indexationRaw,
      has_indexation: indexationRaw ? 1 : null,
      source: "nkr",
      source_url: sourceUrl,
      announcement_url: lot?.announcementUrls[0] ?? null,
      fetched_at: date,
    });
    stats.concessions++;
    stats.fromNkr++;

    insObject.run(
      `obj:${id}:1`,
      id,
      1,
      title,
      classifyObjectKind(title),
      title,
      null,
      null,
      null,
    );

    for (const link of lot?.fileLinks ?? []) {
      insDocument.run(id, null, "file", `https://nkr.government.bg${link}`);
    }
    for (const url of lot?.announcementUrls ?? []) {
      insDocument.run(
        id,
        "Обявление за възложена концесия",
        "announcement",
        url,
      );
    }

    const eik = concessionaireId?.startsWith("eik:")
      ? concessionaireId.slice(4)
      : null;
    if (eik) byEik.set(eik, [...(byEik.get(eik) ?? []), id]);
  }

  // ── 2. data.egov.bg: допълва, никога не презаписва (НКР печели) ─────────
  const egovRows = db
    .prepare<[], { payload: string }>(
      "SELECT payload FROM raw_egov_rows ORDER BY id",
    )
    .all()
    .map((r) => JSON.parse(r.payload) as EgovRow);

  let egovSeq = 0;
  for (const rec of egovRows) {
    egovSeq++;
    if (rec.dataset_name && NKR_MIRROR_RE.test(rec.dataset_name)) {
      stats.mirrorsSkipped++;
      continue;
    }
    const egovUrl = EGOV_URL(rec.resource_uri);
    const eik = rec.eik ? extractEik(rec.eik) : null;
    const matches = eik ? (byEik.get(eik) ?? []) : [];

    if (matches.length > 1) {
      insReview.run(
        "ambiguous_match",
        JSON.stringify({ egov: rec, candidates: matches }),
        date,
      );
      stats.conflicts++;
      continue;
    }

    if (matches.length === 1) {
      const id = matches[0];
      const current = db
        .prepare<
          [string],
          { annual_payment_flag: string; annual_payment_eur: number | null }
        >(
          "SELECT annual_payment_flag, annual_payment_eur FROM concessions WHERE id = ?",
        )
        .get(id!);
      const egovPayment = parseMoney(rec.payment ?? rec.payment_raw);

      if (egovPayment.value != null) {
        // плащането от общинския регистър влиза в payments с произход egov
        insPayment.run(
          id,
          null,
          egovPayment.raw,
          egovPayment.eur,
          egovPayment.flag,
          egovUrl,
        );

        if (current?.annual_payment_flag === "missing") {
          db.prepare(
            `UPDATE concessions SET annual_payment_raw = ?, annual_payment_eur = ?,
               annual_payment_flag = 'parsed_from_text' WHERE id = ?`,
          ).run(egovPayment.raw, egovPayment.eur, id);
          stats.supplemented++;
        } else if (
          current?.annual_payment_eur != null &&
          egovPayment.eur != null &&
          Math.abs(current.annual_payment_eur - egovPayment.eur) > 0.01
        ) {
          db.prepare(
            "UPDATE concessions SET annual_payment_flag = 'contradictory' WHERE id = ?",
          ).run(id);
          insReview.run(
            "source_conflict",
            JSON.stringify({
              concession: id,
              field: "annual_payment",
              nkr_eur: current.annual_payment_eur,
              egov_eur: egovPayment.eur,
              egov_source: egovUrl,
            }),
            date,
          );
          stats.conflicts++;
        }
      }
      continue;
    }

    // няма съвпадение по ЕИК → самостоятелен запис от общинския регистър
    const subject = normText(rec.subject || rec.object_description);
    const regNum =
      normText(rec.concession_id) ||
      `${rec.resource_uri}#${normText(rec.row_number) || egovSeq}`;
    const id = `k:egov:${regNum}`;
    const exists = db
      .prepare<[string], { id: string }>(
        "SELECT id FROM concessions WHERE reg_num = ?",
      )
      .get(regNum);
    if (exists) continue;

    const grantorId = upsertGrantor(rec.grantor ?? null);
    const concessionaireId = upsertConcessionaire(
      rec.concessionaire ?? null,
      rec.eik ?? null,
      egovUrl,
    );
    const term = parseTerm(rec.term);
    const payment = parseMoney(rec.payment ?? rec.payment_raw);

    insConcession.run({
      id,
      reg_num: regNum,
      title: subject || regNum,
      kind: null,
      status: normText(rec.status) || null,
      grantor_id: grantorId,
      concessionaire_id: concessionaireId,
      term_raw: term.raw,
      term_months: term.months,
      term_flag: term.flag,
      value_raw: null,
      value_eur: null,
      value_flag: "missing",
      onetime_raw: null,
      onetime_eur: null,
      onetime_flag: "missing",
      annual_raw: payment.raw,
      annual_eur: payment.eur,
      annual_flag: payment.flag,
      grace_months: null,
      grace_raw: null,
      indexation_raw: null,
      has_indexation: null,
      source: "egov",
      source_url: egovUrl,
      announcement_url: null,
      fetched_at: date,
    });
    stats.concessions++;
    stats.fromEgov++;

    if (subject) {
      insObject.run(
        `obj:${id}:1`,
        id,
        1,
        subject,
        classifyObjectKind(subject),
        subject,
        null,
        null,
        null,
      );
    }
  }

  return stats;
}
