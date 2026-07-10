import { isValidEik } from "shared";
import { normText } from "./text";

const EIK_RE = /\b(\d{9}|\d{13})\b/;

/** Извлича ЕИК (9 или 13 цифри) от свободен текст, напр. полето „концесионер". */
export function extractEik(input: unknown): string | null {
  const m = EIK_RE.exec(normText(input));
  return m && m[1] && isValidEik(m[1]) ? m[1] : null;
}
