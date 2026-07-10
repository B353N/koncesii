import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { marked } from "marked";
import type { Route } from "./+types/methodology";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Методология на индикаторите за риск — КОНЦЕСИИ" },
    {
      name: "description",
      content:
        "Публичната методология на индикаторите за риск: всеки флаг е възпроизводим аритметичен факт с явни прагове.",
    },
  ];
}

/** Методологията се рендира от docs/red-flags.md — един източник на истина. */
export function loader({}: Route.LoaderArgs) {
  const candidates = [
    resolve(process.cwd(), "docs/red-flags.md"),
    resolve(process.cwd(), "../../docs/red-flags.md"),
  ];
  const path = candidates.find(existsSync);
  const md = path
    ? readFileSync(path, "utf8")
    : "# Методология\n\nДокументът не е наличен в тази инсталация.";
  const html = marked.parse(md, { async: false });
  return { html };
}

export default function Methodology({ loaderData }: Route.ComponentProps) {
  return (
    <article
      className="prose-koncesii mx-auto max-w-[72ch] pt-8 pb-10"
      /* Съдържанието идва от docs/red-flags.md в нашето репо, не от потребителски вход. */
      dangerouslySetInnerHTML={{ __html: loaderData.html }}
    />
  );
}
