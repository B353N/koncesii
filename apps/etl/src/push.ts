import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
import Database from "better-sqlite3";
import { verifyReport, type IntegrityReport } from "./report";

/**
 * pnpm db:push — публикува build/koncesii.sqlite на сървъра (ADR-0005):
 *   1. отваря билднатата база наново и проверява integrity отчета на
 *      ingest-а (бройки + суми) — несъответствие спира публикацията;
 *   2. качва файла до временно име и сверява sha256 на двете страни;
 *   3. атомарна подмяна с mv — сайтът никога не вижда половин база.
 *
 *   pnpm db:push [--db build/koncesii.sqlite] [--report build/ingest-report.json]
 *   env: KONCESII_SSH_HOST (imprya), KONCESII_DB_PATH (/data/koncesii/koncesii.sqlite)
 */

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  const v = i !== -1 ? process.argv[i + 1] : undefined;
  return v && !v.startsWith("--") ? v : fallback;
}

function main() {
  const dbPath = arg("--db", join(ROOT, "build/koncesii.sqlite"));
  const reportPath = arg("--report", join(ROOT, "build/ingest-report.json"));
  const host = process.env["KONCESII_SSH_HOST"] ?? "imprya";
  const remotePath =
    process.env["KONCESII_DB_PATH"] ?? "/data/koncesii/koncesii.sqlite";
  const tmpPath = `${remotePath}.new`;

  // 1. повторна проверка на integrity отчета върху файла, който качваме
  const expected = JSON.parse(
    readFileSync(reportPath, "utf8"),
  ) as IntegrityReport;
  const db = new Database(dbPath, { readonly: true });
  const problems = verifyReport(db, expected);
  db.close();
  if (problems.length > 0) {
    console.error(
      "[push] integrity отчетът НЕ съвпада — публикацията е спряна:",
    );
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exit(1);
  }
  console.log(
    `[push] integrity: ${expected.tables["concessions"]} концесии, ` +
      `${expected.flagged_concessions} с индикатор, суми сверени ✓`,
  );

  // 2. качване до временно име + sha256 сверка
  const localSha = createHash("sha256")
    .update(readFileSync(dbPath))
    .digest("hex");
  console.log(`[push] scp ${dbPath} → ${host}:${tmpPath}`);
  execFileSync(
    "ssh",
    [host, "mkdir", "-p", remotePath.replace(/\/[^/]+$/, "")],
    {
      stdio: "inherit",
    },
  );
  execFileSync("scp", ["-q", dbPath, `${host}:${tmpPath}`], {
    stdio: "inherit",
  });
  const remoteSha = execFileSync("ssh", [host, "sha256sum", tmpPath], {
    encoding: "utf8",
  }).split(/\s+/)[0];
  if (remoteSha !== localSha) {
    execFileSync("ssh", [host, "rm", "-f", tmpPath]);
    console.error(
      `[push] sha256 разминаване (${localSha} ≠ ${remoteSha}) — прекратено`,
    );
    process.exit(1);
  }

  // 3. предишната версия остава като .bak, после атомарна подмяна
  execFileSync(
    "ssh",
    [
      host,
      `[ -f '${remotePath}' ] && cp -f '${remotePath}' '${remotePath}.bak'; mv -f '${tmpPath}' '${remotePath}'`,
    ],
    { stdio: "inherit" },
  );
  console.log(
    `[push] публикувано: ${host}:${remotePath} (sha256 ${localSha.slice(0, 12)}…)`,
  );
}

main();
