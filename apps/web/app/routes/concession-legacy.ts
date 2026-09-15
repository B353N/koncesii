import { redirect } from "react-router";
import type { Route } from "./+types/concession-legacy";
import { resolveConcession } from "../queries.server";
import { concessionHref } from "../slug";

/**
 * Resource route: /concessions/* - стари адреси, в които "/" от партидния
 * номер (напр. 221-72/07.10.2020) е станал отделен сегмент, както го
 * нормализират търсачките. Разпознат номер → 301 към slug адреса (и към
 * /json, ако е поискан); иначе 404.
 */
export function loader({ params }: Route.LoaderArgs) {
  const rest = params["*"] ?? "";
  const wantJson = rest.endsWith("/json");
  const raw = wantJson ? rest.slice(0, -"/json".length) : rest;
  const hit = raw ? resolveConcession(raw) : null;
  if (!hit) throw new Response("Not Found", { status: 404 });
  throw redirect(`${concessionHref(hit.slug)}${wantJson ? "/json" : ""}`, 301);
}
