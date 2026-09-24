import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { basename, dirname, extname, join, relative } from "node:path";
import { promisify } from "node:util";

/**
 * pnpm extract — текстовият слой на прикачените документи (фаза E2 от
 * docs/document-extraction.md). Чете манифеста nkr_data/files.jsonl от
 * tools/harvest и за всеки свален файл пише в снапшота:
 *
 *   nkr_data/text/{партида}/{файл}.txt        страниците, разделени с \f
 *   nkr_data/text/{партида}/{файл}.meta.json  метод по страница, версии, sha256
 *
 * PDF с текстов слой → pdftotext; страница без текст (скан) или с
 * нечетим текстов слой → OCR: pdftoppm + tesseract -l bul+eng. Word/RTF/
 * Excel/ODT → LibreOffice → PDF → същото. Изображения → tesseract. ZIP →
 * всеки файл вътре, по ред на името. Инструментите са детерминистични при
 * фиксирани версии; версиите се записват в .meta.json.
 *
 * Възобновимо: файл с .meta.json за същия sha256 и същата версия на
 * извличането се прескача. Ingest-ът чете само кеша — не пуска инструменти.
 *
 *   pnpm extract --local <dir> [--jobs N] [--force] [--limit N]
 */

const pexec = promisify(execFile);

/** Смяна на правилата по-долу → нова версия → всичко се извлича наново. */
export const EXTRACTOR_VERSION = 1;

/** Под толкова непразни знака страницата се води скан и минава през OCR. */
const MIN_PAGE_CHARS = 100;
/** Под този дял букви/цифри текстовият слой е „счупен" шрифт → OCR. */
const MIN_READABLE_RATIO = 0.6;
const OCR_DPI = 300;
const OCR_LANGS = "bul+eng";

export type PageMethod = "text" | "ocr" | "empty" | "needs_ocr";

export interface TextMeta {
  version: number;
  source_file: string;
  source_sha256: string;
  kind: "pdf" | "office" | "image" | "zip" | "unsupported";
  status: "ok" | "empty" | "unsupported" | "error";
  pages: number;
  chars: number;
  page_methods: PageMethod[];
  tools: Record<string, string | null>;
  entries?: Array<{ name: string; first_page: number; pages: number }>;
  error?: string;
}

export interface ManifestRecord {
  lot_guid: string;
  href: string;
  url: string;
  title: string | null;
  status: string;
  file?: string;
  filename?: string | null;
  content_type?: string | null;
  size?: number;
  sha256?: string;
  fetched_at?: string;
  error?: string;
}

/** Манифестът е append-only: последният запис за (партида, href) печели. */
export function readManifest(nkrDir: string): ManifestRecord[] {
  const p = join(nkrDir, "files.jsonl");
  if (!existsSync(p)) return [];
  const last = new Map<string, ManifestRecord>();
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line) as ManifestRecord;
    last.set(`${rec.lot_guid}\n${rec.href}`, rec);
  }
  return [...last.values()].sort(
    (a, b) =>
      a.lot_guid.localeCompare(b.lot_guid) || a.href.localeCompare(b.href),
  );
}

/** files/{lot}/{id}.pdf → text/{lot}/{id} (без разширение). */
export function textBase(nkrDir: string, file: string): string {
  const rel = file.replace(/^files\//, "");
  const noExt = rel.slice(0, rel.length - extname(rel).length);
  return join(nkrDir, "text", noExt);
}

// ── Инструменти ──────────────────────────────────────────────────────────

export interface Tools {
  pdftotext: string | null;
  pdftoppm: string | null;
  tesseract: string | null;
  soffice: string | null;
  unzip: string | null;
}

async function version(cmd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout, stderr } = await pexec(cmd, args, { timeout: 30_000 });
    const line = `${stdout}\n${stderr}`
      .split("\n")
      .map((l) => l.trim())
      .find((l) => /\d+\.\d+/.test(l));
    return line ?? "unknown";
  } catch (e) {
    // pdftotext -v излиза с код 0 или 99 според версията — stderr носи версията
    const err = e as { code?: string | number; stderr?: string };
    if (err.code === "ENOENT") return null;
    const line = (err.stderr ?? "").split("\n").find((l) => /\d+\.\d+/.test(l));
    return line?.trim() ?? null;
  }
}

export async function detectTools(): Promise<Tools> {
  const [pdftotext, pdftoppm, tesseract, soffice, unzip] = await Promise.all([
    version("pdftotext", ["-v"]),
    version("pdftoppm", ["-v"]),
    version("tesseract", ["--version"]),
    version("soffice", ["--version"]),
    version("unzip", ["-v"]),
  ]);
  return { pdftotext, pdftoppm, tesseract, soffice, unzip };
}

// ── Разпознаване на формата по съдържанието ──────────────────────────────

type Sniffed = "pdf" | "office" | "image" | "zip" | "unsupported";

const OFFICE_EXT = new Set([
  ".doc",
  ".docx",
  ".rtf",
  ".odt",
  ".xls",
  ".xlsx",
  ".ods",
  ".ppt",
  ".pptx",
]);

export function sniff(head: Buffer, ext: string): Sniffed {
  const e = ext.toLowerCase();
  if (head.subarray(0, 5).toString("latin1").includes("%PDF")) return "pdf";
  if (head.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0])))
    return "office"; // OLE: .doc / .xls
  if (head.subarray(0, 5).toString("latin1") === "{\\rtf") return "office";
  if (head.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    // docx/xlsx/odt са ZIP; разширението (или името от сървъра) решава
    return OFFICE_EXT.has(e) ? "office" : "zip";
  }
  if (
    head.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ||
    head.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ||
    head.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) ||
    head.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))
  ) {
    return "image";
  }
  if (OFFICE_EXT.has(e)) return "office";
  return "unsupported";
}

// ── Текст ────────────────────────────────────────────────────────────────

/**
 * Дял на кирилица, латиница, цифри и обичайна пунктуация сред непразните
 * знаци. „Счупен" шрифт в PDF дава текстов слой от Ã¾ÀÁ… — такава страница
 * минава през OCR, въпреки че „има текст".
 */
export function readableRatio(text: string): number {
  const compact = text.replace(/\s+/g, "");
  if (!compact.length) return 0;
  const good =
    compact.match(/[\u0400-\u04FFA-Za-z0-9.,;:!?()[\]„“"'%№§\-–—/]/g)?.length ??
    0;
  return good / compact.length;
}

export function needsOcr(pageText: string): boolean {
  const chars = pageText.replace(/\s+/g, "").length;
  return chars < MIN_PAGE_CHARS || readableRatio(pageText) < MIN_READABLE_RATIO;
}

const BIG = { maxBuffer: 512 * 1024 * 1024 };

async function pdfText(path: string): Promise<string[]> {
  const { stdout } = await pexec(
    "pdftotext",
    ["-enc", "UTF-8", "-eol", "unix", path, "-"],
    { ...BIG, timeout: 10 * 60_000 },
  );
  const pages = stdout.split("\f");
  if (pages.length > 1 && pages[pages.length - 1]!.trim() === "") pages.pop();
  return pages;
}

async function ocrImage(path: string): Promise<string> {
  const { stdout } = await pexec(
    "tesseract",
    [path, "stdout", "-l", OCR_LANGS, "--psm", "3"],
    {
      ...BIG,
      timeout: 10 * 60_000,
      env: { ...process.env, OMP_THREAD_LIMIT: "1" },
    },
  );
  return stdout;
}

async function ocrPdfPage(
  path: string,
  page: number,
  work: string,
): Promise<string> {
  const prefix = join(work, `p${page}`);
  await pexec(
    "pdftoppm",
    [
      "-r",
      String(OCR_DPI),
      "-gray",
      "-png",
      "-f",
      String(page),
      "-l",
      String(page),
      "-singlefile",
      path,
      prefix,
    ],
    { ...BIG, timeout: 10 * 60_000 },
  );
  const png = `${prefix}.png`;
  try {
    return await ocrImage(png);
  } finally {
    rmSync(png, { force: true });
  }
}

interface Pages {
  pages: string[];
  methods: PageMethod[];
}

async function pdfPages(
  path: string,
  tools: Tools,
  work: string,
): Promise<Pages> {
  const pages = await pdfText(path);
  const methods: PageMethod[] = [];
  for (let i = 0; i < pages.length; i++) {
    const text = pages[i]!;
    if (!needsOcr(text)) {
      methods.push("text");
      continue;
    }
    if (!tools.tesseract || !tools.pdftoppm) {
      methods.push(text.trim() ? "text" : "needs_ocr");
      continue;
    }
    const ocr = await ocrPdfPage(path, i + 1, work);
    // OCR печели само ако е дал повече четим текст от текстовия слой
    const ocrScore = ocr.replace(/\s+/g, "").length * readableRatio(ocr);
    const txtScore = text.replace(/\s+/g, "").length * readableRatio(text);
    if (ocrScore > txtScore) {
      pages[i] = ocr;
      methods.push(ocr.trim() ? "ocr" : "empty");
    } else {
      methods.push(text.trim() ? "text" : "empty");
    }
  }
  return { pages, methods };
}

async function officeToPdf(path: string, work: string): Promise<string> {
  // LibreOffice разпознава формата по разширението; копието е в работната директория
  const src = join(work, `src${extname(path).toLowerCase() || ".doc"}`);
  copyFileSync(path, src);
  await pexec(
    "soffice",
    [
      `-env:UserInstallation=file://${join(work, "lo-profile")}`,
      "--headless",
      "--convert-to",
      "pdf",
      "--outdir",
      work,
      src,
    ],
    { ...BIG, timeout: 10 * 60_000 },
  );
  const out = join(work, "src.pdf");
  if (!existsSync(out)) throw new Error("LibreOffice не произведе PDF");
  return out;
}

async function filePages(
  path: string,
  kind: Sniffed,
  tools: Tools,
  work: string,
  depth = 0,
): Promise<Pages & { entries?: TextMeta["entries"] }> {
  if (kind === "pdf") {
    if (!tools.pdftotext) throw new Error("липсва pdftotext (poppler)");
    return pdfPages(path, tools, work);
  }
  if (kind === "office") {
    if (!tools.soffice) throw new Error("липсва soffice (LibreOffice)");
    return pdfPages(await officeToPdf(path, work), tools, work);
  }
  if (kind === "image") {
    if (!tools.tesseract) return { pages: [""], methods: ["needs_ocr"] };
    // многостраничен TIFF: tesseract разделя страниците с \f
    const text = await ocrImage(path);
    const pages = text
      .split("\f")
      .filter((p, i, all) => p.trim() || all.length === 1);
    return { pages, methods: pages.map((p) => (p.trim() ? "ocr" : "empty")) };
  }
  if (kind === "zip" && depth === 0) {
    if (!tools.unzip) throw new Error("липсва unzip");
    const dir = join(work, "zip");
    mkdirSync(dir, { recursive: true });
    await pexec("unzip", ["-qq", "-o", path, "-d", dir], BIG).catch(() => {
      // unzip излиза с 1 при предупреждения (напр. кодировка на имената)
    });
    const files = walk(dir).sort();
    const out: Pages & { entries: NonNullable<TextMeta["entries"]> } = {
      pages: [],
      methods: [],
      entries: [],
    };
    for (const f of files) {
      const head = readHead(f);
      const k = sniff(head, extname(f));
      if (k === "unsupported" || k === "zip") continue;
      const sub = join(work, `e${out.entries.length}`);
      mkdirSync(sub, { recursive: true });
      const r = await filePages(f, k, tools, sub, depth + 1);
      out.entries.push({
        name: relative(dir, f),
        first_page: out.pages.length + 1,
        pages: r.pages.length,
      });
      out.pages.push(...r.pages);
      out.methods.push(...r.methods);
    }
    return out;
  }
  throw new Error(`неподдържан формат (${kind})`);
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function readHead(path: string): Buffer {
  const buf = readFileSync(path);
  return buf.subarray(0, 16);
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Извлича един файл; връща meta (текстът е записан до нея). */
export async function extractFile(
  nkrDir: string,
  rec: ManifestRecord,
  tools: Tools,
): Promise<TextMeta> {
  const file = rec.file!;
  const path = join(nkrDir, file);
  const base = textBase(nkrDir, file);
  mkdirSync(dirname(base), { recursive: true });
  const kind = sniff(
    readHead(path),
    extname(rec.filename ?? "") || extname(path),
  );
  const meta: TextMeta = {
    version: EXTRACTOR_VERSION,
    source_file: file,
    source_sha256: rec.sha256 ?? sha256(path),
    kind,
    status: "ok",
    pages: 0,
    chars: 0,
    page_methods: [],
    tools: { ...tools },
  };

  const work = mkdtempSync(join(tmpdir(), "koncesii-extract-"));
  let pages: string[] = [];
  try {
    if (kind === "unsupported") {
      meta.status = "unsupported";
    } else {
      const r = await filePages(path, kind, tools, work);
      pages = r.pages.map((p) => p.replace(/\f/g, "").replace(/\r\n?/g, "\n"));
      meta.page_methods = r.methods;
      if (r.entries) meta.entries = r.entries;
    }
  } catch (e) {
    meta.status = "error";
    meta.error = String((e as Error).message ?? e).slice(0, 500);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  meta.pages = pages.length;
  meta.chars = pages.reduce((n, p) => n + p.replace(/\s+/g, "").length, 0);
  if (meta.status === "ok" && meta.chars === 0) meta.status = "empty";
  writeFileSync(`${base}.txt`, pages.join("\f"));
  writeFileSync(`${base}.meta.json`, JSON.stringify(meta, null, 1) + "\n");
  return meta;
}

function isFresh(nkrDir: string, rec: ManifestRecord): boolean {
  const metaPath = `${textBase(nkrDir, rec.file!)}.meta.json`;
  if (!existsSync(metaPath)) return false;
  try {
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as TextMeta;
    return (
      meta.version === EXTRACTOR_VERSION &&
      (!rec.sha256 || meta.source_sha256 === rec.sha256) &&
      // без OCR инструменти сканът остава „needs_ocr" — опитваме пак с тях
      !meta.page_methods.includes("needs_ocr")
    );
  } catch {
    return false;
  }
}

export interface ExtractSummary {
  files: number;
  skipped: number;
  byStatus: Record<string, number>;
  byMethod: Record<string, number>;
}

export async function runExtract(
  snapshotDir: string,
  opts: { jobs?: number; force?: boolean; limit?: number; tools?: Tools } = {},
): Promise<ExtractSummary> {
  const nkrDir = join(snapshotDir, "nkr_data");
  const tools = opts.tools ?? (await detectTools());
  const all = readManifest(nkrDir).filter(
    (r) => r.status === "ok" && r.file && existsSync(join(nkrDir, r.file)),
  );
  let todo = opts.force ? all : all.filter((r) => !isFresh(nkrDir, r));
  if (opts.limit != null) todo = todo.slice(0, opts.limit);
  const summary: ExtractSummary = {
    files: todo.length,
    skipped: all.length - todo.length,
    byStatus: {},
    byMethod: {},
  };

  const jobs = Math.max(
    1,
    opts.jobs ?? Math.max(1, availableParallelism() - 1),
  );
  let next = 0;
  let done = 0;
  const worker = async () => {
    for (let i = next++; i < todo.length; i = next++) {
      const rec = todo[i]!;
      const meta = await extractFile(nkrDir, rec, tools);
      summary.byStatus[meta.status] = (summary.byStatus[meta.status] ?? 0) + 1;
      for (const m of meta.page_methods) {
        summary.byMethod[m] = (summary.byMethod[m] ?? 0) + 1;
      }
      done++;
      if (meta.status === "error" || meta.status === "unsupported") {
        console.log(
          `[extract][!] ${rec.url} (${basename(rec.file!)}): ${meta.status}${meta.error ? ` — ${meta.error}` : ""}`,
        );
      }
      if (done % 25 === 0 || done === todo.length) {
        console.log(`[extract] ${done}/${todo.length}`);
      }
    }
  };
  await Promise.all(Array.from({ length: jobs }, worker));
  return summary;
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  const v = i !== -1 ? process.argv[i + 1] : undefined;
  return v && !v.startsWith("--") ? v : null;
}

async function main() {
  const local = arg("--local");
  if (!local) {
    console.error(
      "употреба: pnpm extract --local <dir> [--jobs N] [--force] [--limit N]",
    );
    process.exit(2);
  }
  const tools = await detectTools();
  for (const [name, v] of Object.entries(tools)) {
    console.log(`[extract] ${name}: ${v ?? "ЛИПСВА"}`);
  }
  if (!tools.pdftotext) {
    console.error(
      "[extract] нужен е poppler (pdftotext/pdftoppm) — macOS: brew install poppler tesseract tesseract-lang libreoffice",
    );
    process.exit(1);
  }
  if (!tools.tesseract) {
    console.warn(
      "[extract] без tesseract сканираните страници остават без текст (needs_ocr) и ще се опитат пак при следващото пускане",
    );
  }
  const jobs = arg("--jobs");
  const limit = arg("--limit");
  const summary = await runExtract(local, {
    tools,
    force: process.argv.includes("--force"),
    ...(jobs ? { jobs: Number(jobs) } : {}),
    ...(limit ? { limit: Number(limit) } : {}),
  });
  console.log(
    `[extract] готово: ${summary.files} обработени, ${summary.skipped} вече извлечени; ` +
      `статус ${JSON.stringify(summary.byStatus)}; страници ${JSON.stringify(summary.byMethod)}`,
  );
}

if (process.argv[1]?.endsWith("extract.ts")) {
  await main();
}
