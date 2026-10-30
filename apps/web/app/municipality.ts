/**
 * Община на партида - за страниците „Концесии в община X". Регистърът
 * няма такова поле; определя се детерминистично, в този ред:
 *   1. общината на обекта от обявлението (objects.municipality);
 *   2. концедентът е общината („Кмет на община Созопол");
 *   3. „община X" / „общ. X" в предмета или описанието на обекта.
 * Приема се само име от газетира (municipalities.ts). Две общини с едно
 * име (Бяла - Варна и Русе) се различават по областта; без област
 * партидата остава без община - не гадаем.
 */
import { MUNICIPALITIES } from "./municipalities";
import { slugify } from "./slug";

export type MunicipalitySource = "object" | "grantor" | "text";

export interface MunicipalityMatch {
  /** ключ: името с малки букви + областта („бяла|Варна") */
  key: string;
  /** името, както е написано в източника („Долни чифлик") */
  name: string;
  oblast: string;
  source: MunicipalitySource;
}

/** Имена, които източниците пишат иначе от газетира. */
const ALIASES: Record<string, string> = {
  "добрич-град": "добрич",
  "град добрич": "добрич",
  софия: "столична",
  "софия-град": "столична",
  "столична община": "столична",
};

const TEXT_RE = /(?:община|общ\.)\s*([А-ЯЁа-яё-]+(?:\s+[А-ЯЁа-яё-]+)?)/giu;
const OBLAST_RE = /(?:област|обл\.)\s*([А-Яа-я]+(?:\s+[А-Яа-я]+)?)/giu;

function lookupKey(raw: string): string | null {
  const k = raw.trim().toLowerCase().replace(/\s+/gu, " ");
  const key = ALIASES[k] ?? k;
  return MUNICIPALITIES[key] ? key : null;
}

/** Областите, споменати в текста („област Варна", „обл. Русе"). */
function oblastsIn(texts: string[]): string[] {
  const out: string[] = [];
  for (const t of texts)
    for (const m of t.matchAll(OBLAST_RE)) out.push(m[1]!.toLowerCase());
  return out;
}

function pick(
  nameKey: string,
  name: string,
  source: MunicipalitySource,
  oblastHints: string[],
): MunicipalityMatch | null {
  const entries = MUNICIPALITIES[nameKey]!;
  let oblast: string | null = null;
  if (entries.length === 1) oblast = entries[0]![0];
  else {
    const hit = entries.find(([o]) =>
      oblastHints.some((h) => o.toLowerCase().startsWith(h)),
    );
    oblast = hit ? hit[0] : null;
  }
  if (!oblast) return null;
  return { key: `${nameKey}|${oblast}`, name, oblast, source };
}

export function resolveMunicipality(p: {
  objectMunicipality?: string | null;
  objectOblast?: string | null;
  grantorName?: string | null;
  /** предметът и описанията на обектите */
  texts: string[];
}): MunicipalityMatch | null {
  const hints = [
    ...(p.objectOblast ? [p.objectOblast.toLowerCase()] : []),
    ...oblastsIn(p.texts),
  ];
  if (p.objectMunicipality) {
    const k = lookupKey(p.objectMunicipality);
    if (k) return pick(k, p.objectMunicipality.trim(), "object", hints);
  }
  const g = p.grantorName?.trim();
  if (g) {
    const m =
      /(?:община|общински съвет)\s+(.+)$/iu.exec(g) ??
      /^(столична) община$/iu.exec(g);
    const k = m ? lookupKey(m[1]!) : null;
    if (k) return pick(k, m![1]!.trim(), "grantor", hints);
  }
  for (const t of p.texts) {
    for (const m of t.matchAll(TEXT_RE)) {
      // „община Долни чифлик, …" - първо двете думи, после само първата
      const words = m[1]!.split(/\s+/u);
      for (const n of [words.join(" "), words[0]!]) {
        const k = lookupKey(n);
        if (k) {
          const hit = pick(k, n, "text", hints);
          if (hit) return hit;
        }
      }
    }
  }
  return null;
}

/** Показваното име: „Столична" за София, иначе името от източника. */
export function municipalityLabel(name: string): string {
  const n = name.trim();
  const fixed = n.charAt(0).toUpperCase() + n.slice(1);
  return /^столична$/iu.test(n) ? "Столична" : fixed;
}

/**
 * Адресът: името на латиница; при две общини с едно име - и областта
 * (/obshtini/byala-varna, /obshtini/byala-ruse).
 */
export function municipalitySlug(nameKey: string, oblast: string): string {
  const base = slugify(nameKey);
  return (MUNICIPALITIES[nameKey]?.length ?? 1) > 1
    ? `${base}-${slugify(oblast)}`
    : base;
}

const STOP = new Set([
  "концесия",
  "община",
  "област",
  "язовир",
  "находище",
  "поземлен",
  "имот",
  "общ",
  "обл",
]);

/**
 * Концесионер, който всъщност е регистров шум („Не е приложимо", „х",
 * „Открита процедура") - не се брои и не се показва като име.
 */
export function isPlaceholderName(name: string | null | undefined): boolean {
  const n = (name ?? "").trim().toLowerCase();
  return (
    n.length < 3 ||
    /^(не е приложимо|открита процедура|няма|няма данни|няма въведени данни|концесионер)$/u.test(
      n,
    )
  );
}

/** Населените места, изрично назовани в текста („с. Михалково"). */
export function settlementsIn(texts: string[]): string[] {
  const out = new Set<string>();
  // втората дума е с главна буква („Две Могили") или е от честите
  // съставни части на имена („Долна баня", „Долни чифлик")
  const re =
    /(?:^|[\s,(])(?:с\.|село|гр\.|град)\s*([А-Я][а-я]+(?:[\s-](?:[А-Я][а-я]+|баня|бани|чифлик|махала|поле|река|вода))?)/gu;
  for (const t of texts)
    for (const m of t.matchAll(re)) {
      // „Шкорпиловци Концесия за …" - втората дума е началото на изречение
      const [first, second] = m[1]!.split(/[\s-]/u);
      out.add(second && STOP.has(second.toLowerCase()) ? first! : m[1]!);
    }
  return [...out];
}
