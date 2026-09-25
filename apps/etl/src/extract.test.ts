import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractDocFacts, normalizeDocText, splitPages } from "ingest";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  detectTools,
  markupText,
  needsOcr,
  readableRatio,
  run,
  runExtract,
  sniff,
  textBase,
  TimeoutError,
  type TextMeta,
  type Tools,
} from "./extract";

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../packages/ingest/fixtures",
);

describe("разпознаване без инструменти", () => {
  test("sniff по съдържанието, не по разширението", () => {
    expect(sniff(Buffer.from("%PDF-1.4"), ".bin")).toBe("pdf");
    expect(sniff(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), ".pdf")).toBe("office");
    expect(sniff(Buffer.from("{\\rtf1"), "")).toBe("office");
    expect(sniff(Buffer.from([0x50, 0x4b, 0x03, 0x04]), ".docx")).toBe(
      "office",
    );
    expect(sniff(Buffer.from([0x50, 0x4b, 0x03, 0x04]), ".zip")).toBe("zip");
    expect(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "")).toBe("image");
    expect(sniff(Buffer.from("Rar!\x1a\x07\x00", "latin1"), ".bin")).toBe(
      "rar",
    );
    expect(sniff(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), "")).toBe(
      "7z",
    );
    expect(sniff(Buffer.from("<html>"), ".html")).toBe("markup");
    expect(sniff(Buffer.from('<?xml version="1.0"?><a/>'), ".onkr")).toBe(
      "markup",
    );
    expect(sniff(Buffer.from("\xef\xbb\xbf<?xml", "latin1"), ".xml")).toBe(
      "markup",
    );
    expect(sniff(Buffer.from("просто текст"), ".bin")).toBe("unsupported");
  });

  test("страница без текст или със „счупен“ шрифт отива на OCR", () => {
    expect(needsOcr("  \n ")).toBe(true);
    expect(needsOcr("Чл. 3. ".repeat(40))).toBe(false);
    expect(readableRatio("ÃÀÁ¾½ÃÀÁ¾½".repeat(20))).toBeLessThan(0.2);
    expect(needsOcr("ÃÀÁ¾½ÃÀÁ¾½".repeat(20))).toBe(true);
  });

  test("text/ огледално на files/", () => {
    expect(textBase("/s/nkr_data", "files/lot/abc.pdf")).toBe(
      "/s/nkr_data/text/lot/abc",
    );
  });
});

describe("изпълнението на инструментите не виси", () => {
  test("под-процес, който държи изхода отворен, не задържа резултата", async () => {
    // главният процес свършва веднага, но фоновият `sleep` наследява
    // stdout — точно така LibreOffice/tesseract „висяха“ безкрайно
    const t0 = Date.now();
    const r = await run("sh", ["-c", "(sleep 60) & echo готово"], {
      timeoutMs: 30_000,
    });
    expect(r).toMatchObject({ code: 0 });
    expect(r.stdout.trim()).toBe("готово");
    expect(Date.now() - t0).toBeLessThan(10_000);
  }, 15_000);

  test("надвишеното време убива цялата група процеси", async () => {
    const t0 = Date.now();
    await expect(
      run("sh", ["-c", "sleep 60 & sleep 60"], { timeoutMs: 500 }),
    ).rejects.toBeInstanceOf(TimeoutError);
    expect(Date.now() - t0).toBeLessThan(5_000);
  }, 10_000);

  test("липсващ инструмент е грешка, не увисване", async () => {
    await expect(
      run("няма-такава-команда", [], { timeoutMs: 1_000 }),
    ).rejects.toThrow();
  });
});

test("markupText: XML/HTML → текстът между таговете, със същностите", () => {
  const xml = Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?><doc><t>Годишно концесионно възнаграждение: 1 500 лв.</t><!-- бележка --><t>Срок &amp; условия &#8222;x&#8220;</t></doc>',
  );
  expect(markupText(xml)).toBe(
    "Годишно концесионно възнаграждение: 1 500 лв.\nСрок & условия „x“",
  );
  const cp1251 = Buffer.concat([
    Buffer.from('<?xml version="1.0" encoding="windows-1251"?><a>'),
    Buffer.from([0xf1, 0xf0, 0xee, 0xea]), // „срок“ в windows-1251
    Buffer.from("</a>"),
  ]);
  expect(markupText(cp1251)).toBe("срок");
});

describe("броячите и повторните опити, без инструменти", () => {
  const dir = join(tmpdir(), `koncesii-extract-limit-${process.pid}`);
  const nkr = join(dir, "nkr_data");
  const none: Tools = {
    pdftotext: null,
    pdftoppm: null,
    tesseract: null,
    soffice: null,
    unzip: null,
    archiver: null,
  };

  beforeAll(() => {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(nkr, "files", "lot"), { recursive: true });
    const manifest = ["a", "b", "c"].map((id) => {
      writeFileSync(
        join(nkr, "files", "lot", `${id}.bin`),
        "\u0000\u0001 не е документ",
      );
      return JSON.stringify({
        lot_guid: "lot",
        href: `/File/Download/${id}`,
        url: `https://nkr.government.bg/File/Download/${id}`,
        title: id,
        status: "ok",
        file: `files/lot/${id}.bin`,
      });
    });
    writeFileSync(join(nkr, "files.jsonl"), manifest.join("\n") + "\n");
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("--limit: отрязаните чакат, не се броят за извлечени", async () => {
    const r = await runExtract(dir, { tools: none, limit: 1 });
    expect(r).toMatchObject({ files: 1, skipped: 0, remaining: 2 });
    expect(r.byStatus).toEqual({ unsupported: 1 });
  });

  test("неподдържаният формат се опитва пак при следващото пускане", async () => {
    const r = await runExtract(dir, { tools: none });
    expect(r).toMatchObject({ files: 3, skipped: 0, remaining: 0 });
  });
});

// Реалните инструменти (poppler, tesseract, LibreOffice) — на машината на
// поддържащия ги има; в CI без тях тези тестове се прескачат.
const tools: Tools = await detectTools();
const canPdf = Boolean(tools.pdftotext && tools.pdftoppm);
const canOcr = canPdf && Boolean(tools.tesseract);

describe.skipIf(!canPdf)("pnpm extract върху фикстурите", () => {
  const dir = join(tmpdir(), `koncesii-extract-test-${process.pid}`);
  const nkr = join(dir, "nkr_data");
  const lot = "0f0e0d0c-0b0a-4998-8776-655443322110";
  const files = [
    ["contract.pdf", "aa11bb22-cc33-4d44-9e55-ff6677889900.pdf"],
    ["contract_scan.pdf", "scan0001.pdf"],
    ["contract.docx", "word0001.docx"],
    ["contract.rar", "arch0001.rar"],
  ] as const;
  let summary: Awaited<ReturnType<typeof runExtract>>;

  beforeAll(async () => {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(nkr, "files", lot), { recursive: true });
    const manifest = files.map(([src, name]) => {
      cpSync(join(FIXTURES, src), join(nkr, "files", lot, name));
      return JSON.stringify({
        lot_guid: lot,
        href: `/File/Download/${name}`,
        url: `https://nkr.government.bg/File/Download/${name}`,
        title: src,
        status: "ok",
        file: `files/${lot}/${name}`,
      });
    });
    writeFileSync(join(nkr, "files.jsonl"), manifest.join("\n") + "\n");
    summary = await runExtract(dir, { tools, jobs: 2 });
  }, 180_000);

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const read = (name: string) => {
    const base = textBase(nkr, `files/${lot}/${name}`);
    return {
      text: readFileSync(`${base}.txt`, "utf8"),
      meta: JSON.parse(readFileSync(`${base}.meta.json`, "utf8")) as TextMeta,
    };
  };

  test("PDF с текстов слой: две страници, метод text, фактите се намират", () => {
    const { text, meta } = read(files[0][1]);
    expect(meta).toMatchObject({ kind: "pdf", status: "ok", pages: 2 });
    expect(meta.page_methods).toEqual(["text", "text"]);
    // интервалите зависят от версията на poppler — сравнява се нормализирано
    const norm = (t: string) => splitPages(t).map(normalizeDocText);
    expect(norm(text)).toEqual(
      norm(readFileSync(join(FIXTURES, "contract.txt"), "utf8")),
    );
    const facts = extractDocFacts(splitPages(text));
    expect(facts.map((f) => [f.field, f.page])).toEqual([
      ["term", 1],
      ["value", 1],
      ["annual_payment", 2],
      ["onetime_payment", 2],
      ["grace_period", 2],
    ]);
  });

  test.skipIf(!canOcr)("сканирано PDF минава през OCR", () => {
    const { text, meta } = read(files[1][1]);
    expect(meta.page_methods).toEqual(["ocr"]);
    const facts = extractDocFacts(splitPages(text));
    expect(facts.find((f) => f.field === "annual_payment")).toMatchObject({
      amount: 508.03,
      currency: "BGN",
    });
  });

  test.skipIf(!tools.soffice)("DOCX през LibreOffice", () => {
    const { text, meta } = read(files[2][1]);
    expect(meta).toMatchObject({ kind: "office", status: "ok" });
    expect(text).toContain("Годишното концесионно възнаграждение");
  });

  test.skipIf(!tools.archiver)("RAR: документът вътре се извлича", () => {
    const { text, meta } = read(files[3][1]);
    expect(meta).toMatchObject({ kind: "rar", status: "ok", pages: 2 });
    expect(meta.entries).toEqual([
      { name: "dogovor.pdf", first_page: 1, pages: 2 },
    ]);
    expect(text).toContain("Годишното концесионно възнаграждение");
  });

  test("повторното пускане прескача извлечените", async () => {
    const again = await runExtract(dir, { tools });
    // неподдържаните и грешките се опитват пак; всичко друго се прескача
    const retried =
      (summary.byStatus["unsupported"] ?? 0) + (summary.byStatus["error"] ?? 0);
    expect(again.files).toBe(retried);
    expect(again.skipped).toBe(summary.files - retried);
  });
});
