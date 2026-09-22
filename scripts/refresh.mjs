#!/usr/bin/env node
// Пълният цикъл за обновяване на данните, в една команда:
//
//   pnpm refresh [--date ГГГГ-ММ-ДД] [--skip-harvest] [--dry-run]
//
//   1. harvest от НКР и data.egov.bg (часове; 1 заявка/сек, resumable)
//   2. качване на снапшота на сървъра (rsync, идемпотентно)
//   3. ingest → build/koncesii.sqlite + integrity отчет, сверен с
//      предишната база (оттам идва changed_at → lastmod в sitemap-а)
//   4. db:push → атомарна подмяна + известяване на IndexNow
//
// Пуска се от машина с **българско IP** (регистрите режат datacenter
// адреси) - виж docs/etl.md. Стъпка 1 се прескача с --skip-harvest,
// когато снапшотът вече е снет.
//
// Целият изход отива в build/refresh-ГГГГ-ММ-ДД.log, за да има следа
// какво е направил нощният/седмичният пуск.

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(ROOT, "build");
const HARVEST = join(ROOT, "tools/harvest");
const VENV_PYTHON = join(HARVEST, ".venv/bin/python");

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(name);
  const v = i !== -1 ? process.argv[i + 1] : undefined;
  return v && !v.startsWith("--") ? v : fallback;
};
const has = (name) => process.argv.includes(name);

const date = arg("--date") ?? new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error(`невалидна дата: ${date}`);
  process.exit(2);
}
const dryRun = has("--dry-run");

mkdirSync(BUILD, { recursive: true });
const logPath = join(BUILD, `refresh-${date}.log`);

function log(line) {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  console.log(stamped);
  try {
    appendFileSync(logPath, stamped + "\n");
  } catch {
    // логът е удобство, не причина да спре обновяването
  }
}

function run(label, cmd, args, opts = {}) {
  log(`→ ${label}: ${cmd} ${args.join(" ")}`);
  if (dryRun) return;
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd ?? ROOT,
    stdio: "inherit",
    env: process.env,
  });
  if (res.status !== 0) {
    log(`✗ ${label} излезе с код ${res.status ?? "signal " + res.signal}`);
    process.exit(res.status ?? 1);
  }
  log(`✓ ${label}`);
}

log(`refresh ${date} започва${dryRun ? " (dry-run)" : ""}`);

if (!has("--skip-harvest")) {
  const python = existsSync(VENV_PYTHON) ? VENV_PYTHON : "python3";
  run("harvest НКР", python, ["nkr_scraper.py", "all"], { cwd: HARVEST });
  run("harvest data.egov.bg", python, ["egov_concessions_harvest.py", "all"], {
    cwd: HARVEST,
  });
} else {
  log("— harvest прескочен (--skip-harvest)");
}

run("качване на снапшота", "pnpm", ["harvest:upload", "--date", date]);
// пътят се разрешава спрямо apps/etl, затова е абсолютен
run("ingest", "pnpm", ["ingest", "--local", HARVEST, "--date", date]);
run("публикуване", "pnpm", ["db:push"]);

log(`refresh ${date} готов · лог: ${logPath}`);
