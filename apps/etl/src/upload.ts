import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * pnpm harvest:upload — качва изхода на tools/harvest в snapshot
 * хранилището на сървъра (ADR-0005). Идемпотентно и възобновимо:
 * rsync с --checksum качва само променените файлове; завършен датиран
 * префикс е immutable и не се пипа повече.
 *
 *   pnpm harvest:upload --date YYYY-MM-DD
 *   env: KONCESII_SSH_HOST (по подразбиране: imprya)
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  const v = i !== -1 ? process.argv[i + 1] : undefined;
  return v && !v.startsWith("--") ? v : null;
}

function main() {
  const date = arg("--date");
  if (!date || !DATE_RE.test(date)) {
    console.error("употреба: pnpm harvest:upload --date YYYY-MM-DD");
    process.exit(2);
  }
  const host = process.env["KONCESII_SSH_HOST"] ?? "imprya";
  const base = `/data/koncesii/snapshots/${date}`;

  const dirs = [
    [join(ROOT, "tools/harvest/nkr_data"), `${base}/nkr_data`],
    [join(ROOT, "tools/harvest/data"), `${base}/data`],
  ] as const;

  execFileSync("ssh", [host, "mkdir", "-p", base], { stdio: "inherit" });

  for (const [local, remote] of dirs) {
    if (!existsSync(local)) {
      console.log(`[upload] ${local} липсва — прескачам`);
      continue;
    }
    console.log(`[upload] ${local}/ → ${host}:${remote}/`);
    execFileSync(
      "rsync",
      ["-rtz", "--checksum", "--partial", `${local}/`, `${host}:${remote}/`],
      { stdio: "inherit" },
    );
  }
  console.log(`[upload] снапшот ${date} е синхронизиран`);
}

main();
