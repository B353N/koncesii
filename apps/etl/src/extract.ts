import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
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
 * Excel/ODT → LibreOffice → PDF → същото. Изображения → tesseract. XML/HTML
 * → текстът между таговете. ZIP, RAR, 7z → всеки файл вътре, по ред на
 * името (unzip; RAR/7z — 7z/unar, иначе bsdtar, който на macOS е системният
 * `tar`, но не чете „solid" RAR). Повредено PDF → поправка с Ghostscript,
 * иначе OCR на всяка страница, която се рендерира. Инструментите са детерминистични при фиксирани версии;
 * версиите се записват в .meta.json.
 *
 * Всеки инструмент тръгва в собствена група процеси с лимит за време; един
 * файл има общ лимит (по подразбиране 30 мин.). Файл, който го надвиши, се
 * записва като грешка „timeout" и не се опитва отново без --retry-timeouts.
 * Дълъг файл се вижда в лога всяка минута със страницата, до която е стигнал.
 *
 * Възобновимо: файл с .meta.json за същия sha256 и същата версия на
 * извличането се прескача. Ingest-ът чете само кеша — не пуска инструменти.
 *
 *   pnpm extract --local <dir> [--jobs N] [--force] [--limit N]
 *                [--file-timeout МИН] [--retry-timeouts]
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
  kind:
    | "pdf"
    | "office"
    | "image"
    | "markup"
    | "zip"
    | "rar"
    | "7z"
    | "unsupported";
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

// ── Изпълнение на инструментите ─────────────────────────────────────────

export class TimeoutError extends Error {}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Пуска инструмента в собствена група процеси и я убива цялата при
 * надвишено време или след края на главния процес. LibreOffice и
 * tesseract пускат под-процеси; ако се убие само главният, под-процесът
 * държи изхода отворен и командата „виси" безкрайно.
 */
export function run(
  cmd: string,
  args: string[],
  opts: { timeoutMs: number; env?: NodeJS.ProcessEnv },
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: opts.env ?? process.env,
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let errLen = 0;
    child.stdout.on("data", (b: Buffer) => out.push(b));
    child.stderr.on("data", (b: Buffer) => {
      if (errLen < 64 * 1024) {
        err.push(b);
        errLen += b.length;
      }
    });
    const killGroup = () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        // групата вече я няма
      }
    };
    const result = (code: number | null): RunResult => ({
      code,
      stdout: Buffer.concat(out).toString("utf8"),
      stderr: Buffer.concat(err).toString("utf8"),
    });
    let settled = false;
    let grace: NodeJS.Timeout | undefined;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (grace) clearTimeout(grace);
      killGroup(); // останали под-процеси не бива да живеят след инструмента
      fn();
    };
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(
            new TimeoutError(
              `${cmd}: прекъснат след ${Math.round(opts.timeoutMs / 1000)} s`,
            ),
          ),
        ),
      opts.timeoutMs,
    );
    child.on("error", (e) => finish(() => reject(e)));
    child.on("exit", (code) => {
      // под-процес може да държи изхода отворен след края на главния
      grace = setTimeout(() => finish(() => resolve(result(code))), 5_000);
    });
    child.on("close", (code) => finish(() => resolve(result(code))));
  });
}

/** Първият смислен ред от stderr — за съобщението за грешка. */
function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) ?? ""
  ).slice(0, 200);
}

/** Лимит на една стъпка (един инструмент). */
const STEP_MS = 10 * 60_000;

/** Състоянието на един файл: краен срок и напредък за лога. */
interface Ctx {
  deadline: number;
  progress: { page: number; pages: number };
}

/** Колко време има стъпката: до 10 мин., но не след крайния срок на файла. */
function timeLeft(ctx: Ctx): number {
  const left = ctx.deadline - Date.now();
  if (left <= 0) throw new TimeoutError("файлът надвиши лимита за време");
  return Math.min(STEP_MS, left);
}

// ── Инструменти ──────────────────────────────────────────────────────────

export interface Tools {
  pdftotext: string | null;
  pdftoppm: string | null;
  tesseract: string | null;
  soffice: string | null;
  unzip: string | null;
  /**
   * Разархиваторите по ред на опитване: „команда: версия; …". unar първи
   * (стари и „solid" RAR, имена в CP866), после 7-Zip, bsdtar (системният
   * tar на macOS) — последен.
   */
  archiver: string | null;
  /** Ghostscript — поправя повредени PDF, които poppler не може да отвори. */
  gs: string | null;
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

/** Всички налични разархиватори за RAR/7z, по ред на опитване. */
async function detectArchiver(): Promise<string | null> {
  const candidates: Array<[string, string[]]> = [
    // unar първи: чете „solid" и стари RAR методи, които 7-Zip не поддържа,
    // и сам разпознава кирилските имена в CP866 в ZIP от български Windows
    ["unar", ["-v"]],
    ["7zz", ["i"]],
    ["7z", ["i"]],
    ["bsdtar", ["--version"]],
    ["tar", ["--version"]], // на macOS системният tar е bsdtar
  ];
  const found: string[] = [];
  for (const [cmd, args] of candidates) {
    const v = await version(cmd, args);
    if (!v) continue;
    // GNU tar не чете RAR/7z; bsdtar и tar на macOS са едно и също
    if (cmd === "tar" && !/bsdtar|libarchive/i.test(v)) continue;
    if (cmd === "tar" && found.some((f) => f.startsWith("bsdtar:"))) continue;
    found.push(`${cmd}: ${v}`);
  }
  return found.length ? found.join("; ") : null;
}

function archiverCommands(tools: Tools): string[] {
  return (tools.archiver ?? "")
    .split("; ")
    .map((a) => a.split(":")[0]!.trim())
    .filter(Boolean);
}

export async function detectTools(): Promise<Tools> {
  const [pdftotext, pdftoppm, tesseract, soffice, unzip, archiver, gs] =
    await Promise.all([
      version("pdftotext", ["-v"]),
      version("pdftoppm", ["-v"]),
      version("tesseract", ["--version"]),
      version("soffice", ["--version"]),
      version("unzip", ["-v"]),
      detectArchiver(),
      version("gs", ["--version"]),
    ]);
  return { pdftotext, pdftoppm, tesseract, soffice, unzip, archiver, gs };
}

// ── Разпознаване на формата по съдържанието ──────────────────────────────

type Sniffed =
  "pdf" | "office" | "image" | "markup" | "zip" | "rar" | "7z" | "unsupported";
const ARCHIVES = new Set<Sniffed>(["zip", "rar", "7z"]);

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
  // RAR 1.5–4.x и RAR5 започват с „Rar!\x1a\x07"
  if (
    head
      .subarray(0, 6)
      .equals(Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]))
  ) {
    return "rar";
  }
  if (
    head
      .subarray(0, 6)
      .equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))
  ) {
    return "7z";
  }
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
  // XML (напр. електронни формуляри, .onkr) и HTML — текстът е между таговете;
  // Windows често ги записва в UTF-16 с BOM
  if (
    (head[0] === 0xff && head[1] === 0xfe) ||
    (head[0] === 0xfe && head[1] === 0xff)
  ) {
    const le = head[0] === 0xff;
    const decoded = new TextDecoder(le ? "utf-16le" : "utf-16be")
      .decode(head.subarray(2, head.length - (head.length % 2)))
      .trimStart()
      .toLowerCase();
    if (/^<(\?xml|!doctype|html)/.test(decoded)) return "markup";
  }
  const start = head
    .toString("latin1")
    .replace(/^\xef\xbb\xbf/, "")
    .trimStart()
    .toLowerCase();
  if (/^<(\?xml|!doctype|html)/.test(start)) return "markup";
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
    compact.match(/[Ѐ-ӿA-Za-z0-9.,;:!?()[\]„“"'%№§\-–—/]/g)?.length ?? 0;
  return good / compact.length;
}

export function needsOcr(pageText: string): boolean {
  const chars = pageText.replace(/\s+/g, "").length;
  return chars < MIN_PAGE_CHARS || readableRatio(pageText) < MIN_READABLE_RATIO;
}

/**
 * Текстовият слой. Повредено PDF (счупена xref таблица) кара pdftotext да
 * излезе с грешка, но често с частичен текст — той се ползва; без никакъв
 * текст грешката се хвърля и файлът минава изцяло през OCR.
 */
async function pdfText(path: string, ctx: Ctx): Promise<string[]> {
  const r = await run(
    "pdftotext",
    ["-enc", "UTF-8", "-eol", "unix", path, "-"],
    {
      timeoutMs: timeLeft(ctx),
    },
  );
  if (r.code !== 0 && !r.stdout.trim()) {
    throw new Error(`pdftotext: ${firstLine(r.stderr) || `код ${r.code}`}`);
  }
  const pages = r.stdout.split("\f");
  if (pages.length > 1 && pages[pages.length - 1]!.trim() === "") pages.pop();
  return pages;
}

async function ocrImage(path: string, ctx: Ctx): Promise<string> {
  const r = await run(
    "tesseract",
    [path, "stdout", "-l", OCR_LANGS, "--psm", "3"],
    {
      timeoutMs: timeLeft(ctx),
      env: { ...process.env, OMP_THREAD_LIMIT: "1" },
    },
  );
  if (r.code !== 0) {
    throw new Error(`tesseract: ${firstLine(r.stderr) || `код ${r.code}`}`);
  }
  return r.stdout;
}

async function renderPages(
  path: string,
  prefix: string,
  ctx: Ctx,
  page?: number,
): Promise<void> {
  const range = page
    ? ["-f", String(page), "-l", String(page), "-singlefile"]
    : [];
  const r = await run(
    "pdftoppm",
    ["-r", String(OCR_DPI), "-gray", "-png", ...range, path, prefix],
    { timeoutMs: timeLeft(ctx) },
  );
  if (r.code !== 0 && page) {
    throw new Error(`pdftoppm: ${firstLine(r.stderr) || `код ${r.code}`}`);
  }
}

async function ocrPdfPage(
  path: string,
  page: number,
  work: string,
  ctx: Ctx,
): Promise<string> {
  const prefix = join(work, `p${page}`);
  await renderPages(path, prefix, ctx, page);
  const png = `${prefix}.png`;
  try {
    return await ocrImage(png, ctx);
  } finally {
    rmSync(png, { force: true });
  }
}

interface Pages {
  pages: string[];
  methods: PageMethod[];
}

/** Повредено PDF без текстов слой: всяка страница, която се рендерира, → OCR. */
async function ocrWholePdf(
  path: string,
  tools: Tools,
  work: string,
  ctx: Ctx,
  cause: Error,
): Promise<Pages> {
  if (!tools.tesseract || !tools.pdftoppm) throw cause;
  const dir = join(work, "render");
  mkdirSync(dir, { recursive: true });
  await renderPages(path, join(dir, "p"), ctx);
  const pngs = readdirSync(dir)
    .filter((f) => f.endsWith(".png"))
    .sort(
      (a, b) =>
        Number(/(\d+)\.png$/.exec(a)?.[1]) - Number(/(\d+)\.png$/.exec(b)?.[1]),
    );
  if (pngs.length === 0) throw cause;
  ctx.progress.pages = pngs.length;
  const pages: string[] = [];
  for (const [i, f] of pngs.entries()) {
    ctx.progress.page = i + 1;
    pages.push(await ocrImage(join(dir, f), ctx));
    rmSync(join(dir, f), { force: true });
  }
  return { pages, methods: pages.map((p) => (p.trim() ? "ocr" : "empty")) };
}

/** Ghostscript пренаписва повреденото PDF (счупена xref таблица) наново. */
async function repairPdf(
  path: string,
  work: string,
  ctx: Ctx,
): Promise<string | null> {
  const out = join(work, "repaired.pdf");
  const r = await run(
    "gs",
    [
      "-q",
      "-dNOPAUSE",
      "-dBATCH",
      "-dSAFER",
      "-sDEVICE=pdfwrite",
      `-sOutputFile=${out}`,
      path,
    ],
    { timeoutMs: timeLeft(ctx) },
  );
  return r.code === 0 && existsSync(out) ? out : null;
}

async function pdfPages(
  path: string,
  tools: Tools,
  work: string,
  ctx: Ctx,
  repaired = false,
): Promise<Pages> {
  let pages: string[];
  try {
    pages = await pdfText(path, ctx);
  } catch (e) {
    if (e instanceof TimeoutError) throw e;
    if (tools.gs && !repaired) {
      const fixed = await repairPdf(path, work, ctx);
      if (fixed) return pdfPages(fixed, tools, work, ctx, true);
    }
    return ocrWholePdf(path, tools, work, ctx, e as Error);
  }
  ctx.progress.pages = pages.length;
  const methods: PageMethod[] = [];
  for (let i = 0; i < pages.length; i++) {
    ctx.progress.page = i + 1;
    const text = pages[i]!;
    if (!needsOcr(text)) {
      methods.push("text");
      continue;
    }
    if (!tools.tesseract || !tools.pdftoppm) {
      methods.push(text.trim() ? "text" : "needs_ocr");
      continue;
    }
    const ocr = await ocrPdfPage(path, i + 1, work, ctx);
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

async function officeToPdf(
  path: string,
  work: string,
  ctx: Ctx,
): Promise<string> {
  // LibreOffice разпознава формата по разширението; копието е в работната директория
  const src = join(work, `src${extname(path).toLowerCase() || ".doc"}`);
  copyFileSync(path, src);
  const r = await run(
    "soffice",
    [
      `-env:UserInstallation=file://${join(work, "lo-profile")}`,
      "--headless",
      "--norestore",
      "--convert-to",
      "pdf",
      "--outdir",
      work,
      src,
    ],
    { timeoutMs: timeLeft(ctx) },
  );
  const out = join(work, "src.pdf");
  if (!existsSync(out)) {
    throw new Error(
      `LibreOffice не произведе PDF${r.stderr ? `: ${firstLine(r.stderr)}` : ""}`,
    );
  }
  return out;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** XML/HTML → текст: таговете стават нови редове, същностите се декодират. */
export function markupText(buf: Buffer): string {
  const head = buf.subarray(0, 200).toString("latin1");
  const enc = /encoding\s*=\s*["']([\w-]+)["']/i.exec(head)?.[1]?.toLowerCase();
  let text: string;
  if (buf[0] === 0xff && buf[1] === 0xfe) {
    text = new TextDecoder("utf-16le").decode(buf.subarray(2));
  } else if (buf[0] === 0xfe && buf[1] === 0xff) {
    text = new TextDecoder("utf-16be").decode(buf.subarray(2));
  } else {
    try {
      // декларацията „UTF-16" без BOM е рядка — тогава UTF-8
      text = new TextDecoder(
        enc && enc !== "utf-8" && !enc.startsWith("utf-16") ? enc : "utf-8",
      ).decode(buf);
    } catch {
      text = buf.toString("utf8");
    }
  }
  return text
    .replace(/^﻿/, "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&(\w+);/g, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m)
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

async function filePages(
  path: string,
  kind: Sniffed,
  tools: Tools,
  work: string,
  ctx: Ctx,
  depth = 0,
): Promise<Pages & { entries?: TextMeta["entries"] }> {
  if (kind === "pdf") {
    if (!tools.pdftotext) throw new Error("липсва pdftotext (poppler)");
    return pdfPages(path, tools, work, ctx);
  }
  if (kind === "office") {
    if (!tools.soffice) throw new Error("липсва soffice (LibreOffice)");
    return pdfPages(await officeToPdf(path, work, ctx), tools, work, ctx);
  }
  if (kind === "markup") {
    const text = markupText(readFileSync(path));
    return { pages: [text], methods: [text.trim() ? "text" : "empty"] };
  }
  if (kind === "image") {
    if (!tools.tesseract) return { pages: [""], methods: ["needs_ocr"] };
    // многостраничен TIFF: tesseract разделя страниците с \f
    const text = await ocrImage(path, ctx);
    const pages = text
      .split("\f")
      .filter((p, i, all) => p.trim() || all.length === 1);
    return { pages, methods: pages.map((p) => (p.trim() ? "ocr" : "empty")) };
  }
  if (ARCHIVES.has(kind) && depth === 0) {
    const dir = join(work, "archive");
    mkdirSync(dir, { recursive: true });
    await unpack(path, kind, tools, dir, ctx);
    fixEntryNames(dir);
    const files = walk(dir).sort();
    const out: Pages & { entries: NonNullable<TextMeta["entries"]> } = {
      pages: [],
      methods: [],
      entries: [],
    };
    for (const f of files) {
      const head = readHead(f);
      const k = sniff(head, extname(f));
      // архив в архива не се разпакетира — само един слой
      if (k === "unsupported" || ARCHIVES.has(k)) continue;
      const sub = join(work, `e${out.entries.length}`);
      mkdirSync(sub, { recursive: true });
      const r = await filePages(f, k, tools, sub, ctx, depth + 1);
      out.entries.push({
        name: relative(dir, f),
        first_page: out.pages.length + 1,
        pages: r.pages.length,
      });
      out.pages.push(...r.pages);
      out.methods.push(...r.methods);
    }
    if (out.entries.length === 0) {
      throw new Error("архивът няма поддържани документи");
    }
    return out;
  }
  throw new Error(`неподдържан формат (${kind})`);
}

/**
 * Разархивира в dir: ZIP първо с unzip, после — и всичко друго — с първия
 * разархиватор, който успее. bsdtar не чете „solid" RAR; 7-Zip не чете
 * някои стари RAR методи и кирилски имена в CP866 на macOS; unar — да.
 */
async function unpack(
  path: string,
  kind: Sniffed,
  tools: Tools,
  dir: string,
  ctx: Ctx,
): Promise<void> {
  if (kind === "zip" && tools.unzip) {
    // unzip излиза с 1 при предупреждения (напр. кодировка на имената)
    const r = await run("unzip", ["-qq", "-o", path, "-d", dir], {
      timeoutMs: timeLeft(ctx),
    });
    if (r.code === 0 || r.code === 1) return;
  }
  const cmds = archiverCommands(tools);
  if (cmds.length === 0) {
    throw new Error(
      `липсва разархиватор за ${kind} — macOS: brew install unar sevenzip`,
    );
  }
  const failures: string[] = [];
  for (const cmd of cmds) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const args =
      cmd === "7z" || cmd === "7zz"
        ? ["x", "-y", "-bd", `-o${dir}`, path]
        : cmd === "unar"
          ? ["-q", "-f", "-o", dir, path]
          : ["-xf", path, "-C", dir];
    const r = await run(cmd, args, { timeoutMs: timeLeft(ctx) });
    if (r.code === 0) return;
    failures.push(`${cmd}: ${firstLine(r.stderr) || `код ${r.code}`}`);
  }
  throw new Error(
    failures.join(" | ") +
      (!cmds.includes("unar") ? " — опитайте с unar: brew install unar" : ""),
  );
}

const UTF8 = new TextDecoder("utf-8", { fatal: true });
const CP866 = new TextDecoder("ibm866");

/**
 * Имената в архива, които не са валиден UTF-8 (ZIP от български Windows
 * пази кирилицата в CP866), се преименуват към декодираното име — иначе
 * Node не може да ги отвори, а инструментите не могат да ги получат.
 */
function fixEntryNames(dir: string): void {
  for (const raw of readdirSync(dir, { encoding: "buffer" })) {
    let name: string;
    try {
      name = UTF8.decode(raw);
    } catch {
      const decoded = CP866.decode(raw).replace(/[/\\\0]/g, "_");
      // при съвпадение с вече съществуващо име — уникален суфикс
      name = existsSync(join(dir, decoded))
        ? `${decoded}-${raw.toString("hex").slice(0, 8)}`
        : decoded;
      renameSync(Buffer.concat([Buffer.from(`${dir}/`), raw]), join(dir, name));
    }
    const p = join(dir, name);
    if (statSync(p).isDirectory()) fixEntryNames(p);
  }
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
  return buf.subarray(0, 64);
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Лимит за един файл по подразбиране: 30 мин. (--file-timeout в минути). */
const FILE_TIMEOUT_MS = 30 * 60_000;

/** Извлича един файл; връща meta (текстът е записан до нея). */
export async function extractFile(
  nkrDir: string,
  rec: ManifestRecord,
  tools: Tools,
  ctx: Ctx = {
    deadline: Date.now() + FILE_TIMEOUT_MS,
    progress: { page: 0, pages: 0 },
  },
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
      const r = await filePages(path, kind, tools, work, ctx);
      pages = r.pages.map((p) => p.replace(/\f/g, "").replace(/\r\n?/g, "\n"));
      meta.page_methods = r.methods;
      if (r.entries) meta.entries = r.entries;
    }
  } catch (e) {
    meta.status = "error";
    meta.error = `${e instanceof TimeoutError ? "timeout: " : ""}${String(
      (e as Error).message ?? e,
    )}`.slice(0, 500);
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

function isFresh(
  nkrDir: string,
  rec: ManifestRecord,
  retryTimeouts: boolean,
): boolean {
  const metaPath = `${textBase(nkrDir, rec.file!)}.meta.json`;
  if (!existsSync(metaPath)) return false;
  try {
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as TextMeta;
    if (
      meta.version !== EXTRACTOR_VERSION ||
      (rec.sha256 && meta.source_sha256 !== rec.sha256)
    ) {
      return false;
    }
    // файл, надвишил лимита, не се опитва при всяко пускане (иначе всяко
    // пускане чака лимита наново) — само с --retry-timeouts
    if (meta.status === "error" && meta.error?.startsWith("timeout")) {
      return !retryTimeouts;
    }
    // неподдържан формат или грешка може да мине с по-нова версия на
    // извличането или с новоинсталиран инструмент — опитват се пак
    if (meta.status === "unsupported" || meta.status === "error") return false;
    // без OCR инструменти сканът остава „needs_ocr" — опитваме пак с тях
    return !meta.page_methods.includes("needs_ocr");
  } catch {
    return false;
  }
}

export interface ExtractSummary {
  /** Обработени при това пускане. */
  files: number;
  /** Вече извлечени отпреди (прескочени). */
  skipped: number;
  /** Чакат следващо пускане — отрязани от --limit. */
  remaining: number;
  byStatus: Record<string, number>;
  byMethod: Record<string, number>;
}

export async function runExtract(
  snapshotDir: string,
  opts: {
    jobs?: number;
    force?: boolean;
    limit?: number;
    tools?: Tools;
    /** Лимит за един файл, в милисекунди. */
    fileTimeoutMs?: number;
    retryTimeouts?: boolean;
  } = {},
): Promise<ExtractSummary> {
  const nkrDir = join(snapshotDir, "nkr_data");
  const tools = opts.tools ?? (await detectTools());
  const all = readManifest(nkrDir).filter(
    (r) => r.status === "ok" && r.file && existsSync(join(nkrDir, r.file)),
  );
  const pending = opts.force
    ? all
    : all.filter((r) => !isFresh(nkrDir, r, opts.retryTimeouts ?? false));
  const todo = opts.limit != null ? pending.slice(0, opts.limit) : pending;
  const summary: ExtractSummary = {
    files: todo.length,
    skipped: all.length - pending.length,
    remaining: pending.length - todo.length,
    byStatus: {},
    byMethod: {},
  };

  const jobs = Math.max(
    1,
    opts.jobs ?? Math.max(1, availableParallelism() - 1),
  );
  let next = 0;
  let done = 0;
  const fileTimeoutMs = opts.fileTimeoutMs ?? FILE_TIMEOUT_MS;
  // файловете в обработка — за съобщение, когато някой работи дълго
  const active = new Map<number, { name: string; start: number; ctx: Ctx }>();
  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const a of active.values()) {
      const min = Math.floor((now - a.start) / 60_000);
      if (min < 1) continue;
      const p = a.ctx.progress;
      console.log(
        `[extract] … ${a.name} работи от ${min} мин.` +
          (p.pages ? ` (стр. ${p.page}/${p.pages})` : ""),
      );
    }
  }, 60_000);
  heartbeat.unref();

  const worker = async () => {
    for (let i = next++; i < todo.length; i = next++) {
      const rec = todo[i]!;
      const ctx: Ctx = {
        deadline: Date.now() + fileTimeoutMs,
        progress: { page: 0, pages: 0 },
      };
      active.set(i, { name: basename(rec.file!), start: Date.now(), ctx });
      const meta = await extractFile(nkrDir, rec, tools, ctx);
      active.delete(i);
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
  try {
    await Promise.all(Array.from({ length: jobs }, worker));
  } finally {
    clearInterval(heartbeat);
  }
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
      "употреба: pnpm extract --local <dir> [--jobs N] [--force] [--limit N] [--file-timeout МИН] [--retry-timeouts]",
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
  if (!tools.archiver?.startsWith("unar:")) {
    console.warn(
      "[extract] без unar старите/„solid“ RAR и ZIP с кирилски имена (CP866) може да не се отворят — macOS: brew install unar",
    );
  }
  if (!tools.gs) {
    console.warn(
      "[extract] без Ghostscript повредените PDF минават направо през OCR — macOS: brew install ghostscript",
    );
  }
  if (!tools.tesseract) {
    console.warn(
      "[extract] без tesseract сканираните страници остават без текст (needs_ocr) и ще се опитат пак при следващото пускане",
    );
  }
  const jobs = arg("--jobs");
  const limit = arg("--limit");
  const fileTimeout = arg("--file-timeout");
  const summary = await runExtract(local, {
    tools,
    force: process.argv.includes("--force"),
    retryTimeouts: process.argv.includes("--retry-timeouts"),
    ...(fileTimeout ? { fileTimeoutMs: Number(fileTimeout) * 60_000 } : {}),
    ...(jobs ? { jobs: Number(jobs) } : {}),
    ...(limit ? { limit: Number(limit) } : {}),
  });
  console.log(
    `[extract] готово: ${summary.files} обработени, ${summary.skipped} вече извлечени` +
      (summary.remaining > 0
        ? `, ${summary.remaining} чакат (--limit) — пуснете отново без --limit`
        : "") +
      "; " +
      `статус ${JSON.stringify(summary.byStatus)}; страници ${JSON.stringify(summary.byMethod)}`,
  );
}

if (process.argv[1]?.endsWith("extract.ts")) {
  await main();
}
