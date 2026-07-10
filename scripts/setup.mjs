#!/usr/bin/env node
// One-time dev setup. Grows with the project: local D1 + sample fixtures land
// here with packages/db (v1 plan, phase 1).
import { execSync } from "node:child_process";

const run = (cmd) => {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
};

run("pnpm install");

console.log(
  "\n✓ setup done. Local D1 + sample data arrive with packages/db (see docs/v1-implementation-plan.md).\n  Start developing with: pnpm dev",
);
