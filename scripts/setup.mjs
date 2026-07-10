#!/usr/bin/env node
// One-time dev setup: инсталира зависимостите и билдва локална SQLite база
// от фикстурите (контрибуторите нямат нужда от достъп до регистрите).
import { execSync } from "node:child_process";

const run = (cmd) => {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
};

run("pnpm install");
run(
  "pnpm --filter etl ingest --fixtures --out ../../build/koncesii.local.sqlite",
);

console.log(
  "\n✓ setup done: зависимости + локална база от фикстури (build/koncesii.local.sqlite).\n  Start developing with: pnpm dev",
);
