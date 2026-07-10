import { parse, type HTMLElement } from "node-html-parser";
import { normText } from "./text";

/**
 * Парсер на Preview обявленията на НКР (напр. Обявление за възложена
 * концесия). Проверена на живо структура: `.concession-assignment >
 * .section-content` (Раздел I–XI) `> .form-group`, с номерирани подточки
 * (9.6.1, 9.12.2 …) като плосък текст. Порт на parse_preview от
 * tools/harvest/nkr_scraper.py — TS версията е каноничната занапред.
 */
export interface PreviewSection {
  text: string;
  /** „9.6.1 Годишно концесионно възнаграждение" → „259,75 лв." */
  items?: Record<string, string | null>;
  /** form-group стойности за секции без номерация (напр. Раздел VI). */
  groups?: string[];
}

export interface ParsedPreview {
  sections: Record<string, PreviewSection>;
}

const ROMAN_SECTION_RE = /^Раздел\s+([IVX]+)\.\s*(.*)$/u;
const NUMBERED_RE = /^(\d{1,2}(?:\.\d{1,2}){1,3})\.\s+(.*)$/su;

/** Разбива „плосък" текст по подточки от вида „9.12.1. Label: value". */
export function splitNumbered(text: string): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const marked = text.replace(
    /(?<!\d)(\d{1,2}(?:\.\d{1,2}){1,3})\.\s+/gu,
    "\n$1. ",
  );
  for (const chunkRaw of marked.split("\n")) {
    const m = NUMBERED_RE.exec(chunkRaw.trim());
    if (!m || !m[1] || !m[2]) continue;
    const [label, , value] = partition(m[2], ":");
    out[`${m[1]} ${normText(label)}`] = normText(value) || null;
  }
  return out;
}

function partition(s: string, sep: string): [string, string, string] {
  const i = s.indexOf(sep);
  return i === -1 ? [s, "", ""] : [s.slice(0, i), sep, s.slice(i + 1)];
}

function textOf(node: HTMLElement): string {
  // structuredText слага нов ред между блоковете (като get_text(" ") + clean).
  return normText(node.structuredText.replace(/\n/g, " "));
}

export function parsePreview(html: string): ParsedPreview {
  const root = parse(html);
  for (const sel of ["script", "style", "nav", "header", "footer"]) {
    for (const el of root.querySelectorAll(sel)) el.remove();
  }

  const sections: Record<string, PreviewSection> = {};
  const containers = root.querySelectorAll(".section-content");

  if (containers.length === 0) {
    // fallback: генерично номерирано разбиване върху целия текст
    const flat = textOf(root);
    sections["_flat"] = { text: flat, items: splitNumbered(flat) };
    return { sections };
  }

  for (const sec of containers) {
    const head = sec.querySelector("h1, h2, h3, h4, h5, strong, b");
    const title = head ? normText(head.text) : "";
    let bodyText = textOf(sec);
    if (title && bodyText.startsWith(title)) {
      bodyText = normText(bodyText.slice(title.length));
    }

    const m = ROMAN_SECTION_RE.exec(title);
    const key =
      m && m[1]
        ? `${m[1]} ${(m[2] ?? "").replace(/:$/, "")}`
        : title || "untitled";

    const entry: PreviewSection = { text: bodyText };
    const numbered = splitNumbered(bodyText);
    if (Object.keys(numbered).length > 0) entry.items = numbered;

    if (!entry.items) {
      const groups = sec
        .querySelectorAll(".form-group")
        .map((fg) => textOf(fg))
        .filter(Boolean);
      if (groups.length > 0) entry.groups = groups;
    }
    sections[key] = entry;
  }

  return { sections };
}
