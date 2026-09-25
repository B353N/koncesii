import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { beforeAll, expect, test } from "vitest";

/**
 * ЕГН от регистъра не стига до нито един изход на сайта: списъци, детайл
 * (и /json, и данните за хидратация), фирми, текст на документи, търсене.
 * Базата е от миграцията, с измислен ЕГН с валидна контролна цифра.
 */
const EGN = "7501020018";
const ID_CARD = "600123457"; // измислен номер на лична карта
const EIK = "201207954";
const PERSON = `Иван Петров Иванов с ЕГН ${EGN}`;
const PERSON_ID = `name:иван-петров-иванов-с-егн-${EGN}`;
const DOC_URL =
  "https://nkr.government.bg/File/Download/aa11bb22-cc33-4d44-9e55-ff6677889900";

let q: typeof import("./queries.server");

beforeAll(async () => {
  const path = join(mkdtempSync(join(tmpdir(), "koncesii-egn-")), "db.sqlite");
  const db = new Database(path);
  db.exec(
    readFileSync(
      new URL("../../../packages/db/migrations/0000_init.sql", import.meta.url),
      "utf8",
    ),
  );
  db.exec(`
    INSERT INTO concessionaires (id, eik, name, normalized_name)
      VALUES ('${PERSON_ID}', NULL, '${PERSON}', '${PERSON.toLowerCase()}');
    INSERT INTO concessions (id, reg_num, title, concessionaire_id, source, source_url, fetched_at,
                             annual_payment_raw, annual_payment_eur, annual_payment_flag)
      VALUES ('k:D-000001', 'D-000001', 'Концесия за язовир „Горно"', '${PERSON_ID}',
              'nkr', 'https://nkr.government.bg/x', '2026-09-25', '100 лв.', 100, 'ok');
    INSERT INTO objects (id, concession_id, seq, description, kind, lat, lon)
      VALUES ('obj:1', 'k:D-000001', 1, 'язовир „Горно"', 'dam', 42.7, 23.3);
    INSERT INTO documents (id, concession_id, title, url, text_status, text_method, page_count)
      VALUES (1, 'k:D-000001', 'Договор', '${DOC_URL}', 'ok', 'ocr', 1);
    INSERT INTO document_pages (id, document_id, page, method, text)
      VALUES (1, 1, 1, 'ocr', 'Концесионер: ${PERSON}, л.к. № ${ID_CARD}, изд. на 01.02.2015 г. от МВР - Пловдив, с годишно възнаграждение 100 лв. Концедент: Община Горно, ЕИК ${EIK}.');
    INSERT INTO document_pages_fts (rowid, text)
      SELECT id, text FROM document_pages;
    INSERT INTO extracted_facts (concession_id, document_id, field, value_raw, value_eur, quote,
                                 page, document_url, anchor, priority, rank, outcome, extracted_at)
      VALUES ('k:D-000001', 1, 'annual_payment', '100 лв.', 51.13,
              '${PERSON}, с годишно възнаграждение 100 лв.', 1, '${DOC_URL}',
              'годишно възнаграждение', 1, 1, 'agrees', '2026-09-25');
  `);
  db.close();
  process.env["KONCESII_DB"] = path;
  q = await import("./queries.server");
});

const leaks = (value: unknown) => JSON.stringify(value).includes(EGN);

test("списъците, фирмите, картата и детайлът показват името без ЕГН", () => {
  const { rows } = q.listConcessions({});
  expect(rows[0]?.concessionaire_name).toBe("Иван Петров Иванов");
  expect(leaks(rows)).toBe(false);
  expect(leaks(q.listCompanies())).toBe(false);
  expect(leaks(q.listFlagged())).toBe(false);
  expect(leaks(q.topByTerm(10))).toBe(false);
  expect(q.mapPoints()[0]?.company).toBe("Иван Петров Иванов");

  const detail = q.getConcession("D-000001");
  expect(detail?.concessionaire?.name).toBe("Иван Петров Иванов");
  expect(detail?.concessionaire?.id).toBe("name:иван-петров-иванов");
  expect(leaks(detail)).toBe(false);
});

test("текстът на документите и търсенето не показват ЕГН", () => {
  const key = q.getConcession("D-000001")!.documents[0]!.key;
  const doc = q.getDocumentText("D-000001", key);
  expect(doc?.pages[0]?.text).toContain("ЕГН **********");
  expect(leaks(doc)).toBe(false);

  const hits = q.searchDocuments("Иванов възнаграждение");
  expect(hits.total).toBe(1);
  expect(leaks(hits)).toBe(false);
});

test("търсене по ЕГН не връща нищо", () => {
  expect(q.listConcessions({ q: EGN }).total).toBe(0);
  expect(q.searchDocuments(EGN).total).toBe(0);
  expect(q.listConcessions({ q: "Иванов" }).total).toBe(1);
});

test("номерът на лична карта не се показва и не се търси, ЕИК се търси", () => {
  const hides = (value: unknown) => !JSON.stringify(value).includes(ID_CARD);
  const key = q.getConcession("D-000001")!.documents[0]!.key;
  const doc = q.getDocumentText("D-000001", key);
  expect(doc?.pages[0]?.text).toContain("л.к. № *********");
  expect(doc?.pages[0]?.text).toContain(`ЕИК ${EIK}`);
  expect(hides(doc)).toBe(true);

  expect(hides(q.searchDocuments("Иванов Пловдив"))).toBe(true);
  expect(q.searchDocuments(ID_CARD).total).toBe(0);
  expect(q.searchDocuments(`л.к. ${ID_CARD}`).total).toBe(0);
  expect(q.searchDocuments(EIK).total).toBe(1);
});
