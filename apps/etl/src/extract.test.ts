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
import { extractDocFacts, splitPages } from "ingest";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  detectTools,
  needsOcr,
  readableRatio,
  runExtract,
  sniff,
  textBase,
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
    expect(sniff(Buffer.from("<html>"), ".html")).toBe("unsupported");
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
    expect(text).toBe(readFileSync(join(FIXTURES, "contract.txt"), "utf8"));
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
      amount: 259.75,
      currency: "BGN",
    });
  });

  test.skipIf(!tools.soffice)("DOCX през LibreOffice", () => {
    const { text, meta } = read(files[2][1]);
    expect(meta).toMatchObject({ kind: "office", status: "ok" });
    expect(text).toContain("Годишното концесионно възнаграждение");
  });

  test("повторното пускане прескача извлечените", async () => {
    const again = await runExtract(dir, { tools });
    expect(again.files).toBe(0);
    expect(again.skipped).toBe(summary.files);
  });
});
