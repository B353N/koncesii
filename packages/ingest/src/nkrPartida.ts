import { parse } from "node-html-parser";
import { normText } from "./text";

/**
 * Парсер на партидната страница на НКР
 * (/ConcessionaireProcedures/ConcessionaireProcedureInfo/{guid}).
 * Вади линковете към Preview обявленията и файловете за сваляне —
 * порт на details/parse стъпките от tools/harvest/nkr_scraper.py.
 */
export interface PartidaLinks {
  title: string | null;
  /** /Preview/{Вид}/{guid} — AssignedConcession, ConcessionProcedure … */
  previewLinks: string[];
  /** /File/Download/{guid} и /Content/Download/… — договори и документи. */
  fileLinks: string[];
}

const PREVIEW_RE = /\/Preview\/[A-Za-z]+\/[0-9a-f-]{36}/gi;
const TITLE_RE = /партида\s+на\s+концесия/i;

export function parsePartida(html: string): PartidaLinks {
  const previewLinks = [...new Set(html.match(PREVIEW_RE) ?? [])].sort();

  const root = parse(html);
  const fileLinks = [
    ...new Set(
      root
        .querySelectorAll("a[href]")
        .map((a) => a.getAttribute("href") ?? "")
        .filter(
          (href) =>
            href.includes("/File/Download") ||
            href.includes("/Content/Download"),
        ),
    ),
  ].sort();

  let title: string | null = null;
  for (const node of root.querySelectorAll(
    "h1, h2, h3, title, .page-title, div, span",
  )) {
    const text = normText(node.text);
    if (TITLE_RE.test(text)) {
      title = text;
      break;
    }
  }

  return { title, previewLinks, fileLinks };
}

/** GUID и видът на документа от Preview URL: /Preview/AssignedConcession/{guid}. */
export function previewMeta(
  url: string,
): { kind: string; guid: string } | null {
  const m = /\/Preview\/([A-Za-z]+)\/([0-9a-f-]{36})/i.exec(url);
  return m && m[1] && m[2] ? { kind: m[1], guid: m[2].toLowerCase() } : null;
}
