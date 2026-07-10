#!/usr/bin/env node
// Docs integrity: every relative markdown link resolves to an existing file,
// and every file in docs/ is reachable from an index (docs/README.md or
// docs/adr/README.md). CI fails on a dangling reference or an unindexed doc.
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");

export function extractLinks(markdown) {
  const links = [];
  const re = /\[[^\]]*\]\(([^)\s]+)\)/g;
  let m;
  while ((m = re.exec(markdown)) !== null) {
    const target = m[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    links.push(target.split("#")[0]);
  }
  return links.filter(Boolean);
}

export function markdownFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    if (statSync(p).isDirectory()) out.push(...markdownFiles(p));
    else if (entry.endsWith(".md")) out.push(p);
  }
  return out;
}

function main() {
  const errors = [];
  const rootDocs = ["README.md", "AGENTS.md", "CONTRIBUTING.md", "CLAUDE.md"]
    .map((f) => join(ROOT, f))
    .filter(existsSync);
  const docFiles = markdownFiles(join(ROOT, "docs"));
  const allFiles = [...rootDocs, ...docFiles];

  // 1. Every relative link resolves.
  for (const file of allFiles) {
    for (const link of extractLinks(readFileSync(file, "utf8"))) {
      const target = resolve(dirname(file), link);
      if (!existsSync(target)) {
        errors.push(`${relative(ROOT, file)}: dangling link -> ${link}`);
      }
    }
  }

  // 2. Every doc under docs/ is linked from one of the indexes.
  const indexes = [
    join(ROOT, "docs/README.md"),
    join(ROOT, "docs/adr/README.md"),
  ]
    .filter(existsSync)
    .map((f) => ({ file: f, links: extractLinks(readFileSync(f, "utf8")) }));
  for (const doc of docFiles) {
    if (
      indexes.some(
        (i) => resolve(dirname(i.file), ".") === dirname(doc) && i.file === doc,
      )
    )
      continue;
    const indexed = indexes.some((i) =>
      i.links.some((l) => resolve(dirname(i.file), l) === doc),
    );
    const isIndex = indexes.some((i) => i.file === doc);
    if (!indexed && !isIndex) {
      errors.push(`${relative(ROOT, doc)}: not linked from any docs index`);
    }
  }

  if (errors.length) {
    for (const e of errors) console.error(`✗ ${e}`);
    process.exit(1);
  }
  console.log(`✓ docs integrity: ${allFiles.length} files checked, no issues`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)
) {
  main();
}
