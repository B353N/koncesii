import type { ObjectKind } from "shared";
import { normText } from "./text";

/**
 * Детерминистичен класификатор на обекта по предмета/описанието
 * (docs/core-scope.md). Редът има значение: по-специфичните правила са
 * преди по-общите (кариера преди добив, минерална вода преди находище).
 * Класификацията винаги пази и суровия предмет (kind_raw в схемата).
 */
const RULES: ReadonlyArray<readonly [ObjectKind, RegExp]> = [
  ["dam", /язовир|водоем|хидровъзел|рибарник/iu],
  ["beach", /морски\s+плаж|плаж/iu],
  ["mineral_water", /минерална\s+вода|минерални\s+води/iu],
  [
    "quarry",
    /кариера|инертни\s+материали|баластриера|строителни\s+материали/iu,
  ],
  [
    "mining",
    /подземни\s+богатства|находище|добив|рудник|разработване\s+на\s+залеж/iu,
  ],
  ["port", /пристанище|пристан|яхтено|кей/iu],
  [
    "infrastructure",
    /летище|жп|железопът|автогара|тунел|мост|пътна\s+инфраструктур/iu,
  ],
  ["property", /имот|сграда|терен|поземлен|застроен|помещение/iu],
  ["service", /услуга|дейност|поддържане|управление|експлоатация/iu],
];

export function classifyObjectKind(subject: unknown): ObjectKind {
  const text = normText(subject);
  if (!text) return "other";
  for (const [kind, re] of RULES) {
    if (re.test(text)) return kind;
  }
  return "other";
}
