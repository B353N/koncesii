// Общи домейн константи и типове (docs/core-scope.md е източникът на истина).

/** Качество на парсната стойност; оригиналът никога не се презаписва. */
export type ValueFlag = "ok" | "parsed_from_text" | "missing" | "contradictory";

export const VALUE_FLAGS: readonly ValueFlag[] = [
  "ok",
  "parsed_from_text",
  "missing",
  "contradictory",
];

/** Префикси на текстовите PK по същност. */
export const ID_PREFIX = {
  concession: "k:",
  concessionOld: "k:old:",
  grantor: "gr:",
  concessionaireByEik: "eik:",
  concessionaireByName: "name:",
  object: "obj:",
  procedure: "p:",
  flag: "flag:",
} as const;

/** Затворената таксономия на обектите (objects.kind). */
export type ObjectKind =
  | "dam"
  | "beach"
  | "mining"
  | "quarry"
  | "mineral_water"
  | "port"
  | "infrastructure"
  | "property"
  | "service"
  | "other";

export const OBJECT_KINDS: readonly ObjectKind[] = [
  "dam",
  "beach",
  "mining",
  "quarry",
  "mineral_water",
  "port",
  "infrastructure",
  "property",
  "service",
  "other",
];

/** Фиксираният курс за конверсия на стойности отпреди еврото. */
export const BGN_PER_EUR = 1.95583;

/** Валиден ЕИК е 9 или 13 цифри. */
export function isValidEik(value: string): boolean {
  return /^(\d{9}|\d{13})$/.test(value);
}
