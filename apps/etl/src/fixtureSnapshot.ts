import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Сглобява снапшот по формàта на tools/harvest от фикстурите на
 * packages/ingest — за тестовете и за `pnpm setup` (контрибуторите
 * получават локална база без достъп до регистрите).
 */
export const FIXTURE_LOT_GUID = "0f0e0d0c-0b0a-4998-8776-655443322110";
export const FIXTURE_DOC_GUID = "1a2b3c4d-5e6f-4a1b-8c2d-9e0f1a2b3c4d";
export const FIXTURE_DATE = "2026-07-08";

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../packages/ingest/fixtures",
);

export function buildFixtureSnapshot(dir: string): void {
  rmSync(dir, { recursive: true, force: true });

  const lotDir = join(dir, "nkr_data", "html", FIXTURE_LOT_GUID);
  mkdirSync(lotDir, { recursive: true });

  // Индексът от Search обхождането (реалните хедъри на НКР; експортът
  // на регистъра връща 500 от 07.2026, затова индексът е базата).
  const indexDir = join(dir, "nkr_data", "index");
  mkdirSync(indexDir, { recursive: true });
  const indexRows = [
    {
      guid: FIXTURE_LOT_GUID,
      Номер: "O-000123",
      "Статус на партида": "Действаща",
      "Име на концесия": "Язовир „Мътница“",
      "Вид на концесия": "Общинска",
      "Предмет на концесия": "Концесия за строителство",
      Концедент: "Община Смолян",
      _section: "concessions",
    },
    {
      guid: "aaaa1111-2222-4333-8444-555566667777",
      Номер: "D-000078",
      "Статус на партида": "Действаща",
      "Име на концесия": "Язовир „Голям Беглик“",
      "Вид на концесия": "Държавна",
      "Предмет на концесия": "Концесия за услуги",
      Концедент: "Министър на земеделието",
      _section: "concessions",
    },
    {
      guid: "bbbb1111-2222-4333-8444-555566667777",
      Номер: "O-000391",
      "Статус на партида": "Прекратена",
      "Име на концесия": "Язовир „Смилян“",
      "Вид на концесия": "Общинска",
      "Предмет на концесия": "Концесия за ползване",
      Концедент: "Община Смолян",
      _section: "concessions",
    },
  ];
  writeFileSync(
    join(indexDir, "concessions.jsonl"),
    indexRows.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
  cpSync(join(FIXTURES, "partida.html"), join(lotDir, "partida.html"));
  cpSync(
    join(FIXTURES, "assigned_concession.html"),
    join(lotDir, `AssignedConcession_${FIXTURE_DOC_GUID}.html`),
  );

  const dsDir = join(dir, "data", "raw", "obshtina-smolyan-koncesii");
  mkdirSync(dsDir, { recursive: true });
  writeFileSync(
    join(dsDir, "_dataset.json"),
    JSON.stringify({
      uri: "obshtina-smolyan-koncesii",
      name: "Регистър на концесиите — Община Смолян",
      source: "Община Смолян",
      updated_at: "2026-05-14",
    }),
  );
  cpSync(join(FIXTURES, "egov_resource.json"), join(dsDir, "res-001.json"));

  // Огледало на НКР, качено като общински набор — реален случай от
  // data.egov.bg (58 117 от 59 057 реда в harvest-а от 07.2026).
  // Редовете са същите като res-001 и биха дублирали данни, ако филтърът
  // в stageEgov не ги прескочи.
  const mirrorDir = join(dir, "data", "raw", "nkr-ogledalo-smolyan");
  mkdirSync(mirrorDir, { recursive: true });
  writeFileSync(
    join(mirrorDir, "_dataset.json"),
    JSON.stringify({
      uri: "nkr-ogledalo-smolyan",
      name: "Национален концесионен регистър — извадка на Община Смолян",
      source: "Община Смолян",
      updated_at: "2026-05-14",
    }),
  );
  cpSync(join(FIXTURES, "egov_resource.json"), join(mirrorDir, "res-002.json"));
}
