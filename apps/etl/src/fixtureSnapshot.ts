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
  cpSync(
    join(FIXTURES, "export_concessions.win1251.tsv"),
    join(dir, "nkr_data", "export_concessions_raw.tsv"),
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
}
