import { redirect } from "react-router";
import type { Route } from "./+types/legacy-redirect";
import {
  blogHref,
  companyHref,
  concessionHref,
  concessionJsonHref,
  documentHref,
  grantorHref,
  kindHref,
  PATHS,
} from "../paths";
import { getCompanyName, resolveConcession } from "../queries.server";
import { KIND_SLUGS } from "../slug";

/**
 * Английските адреси отпреди 25.09.2026 → латинските. Всеки стар адрес
 * отива с ЕДНО 301 направо на крайния (стар slug на партида, суров номер,
 * номер, разцепен на "/" от търсачка - всичко минава през
 * resolveConcession), за да не губят търсачките сигнал по вериги.
 * Query низът (?page=, ?code=) се пренася.
 */
const SIMPLE: Record<string, string> = {
  "/concessions": PATHS.concessions,
  "/concessions.csv": PATHS.concessionsCsv,
  "/grantors": PATHS.grantors,
  "/grantors.csv": PATHS.grantorsCsv,
  "/companies": PATHS.companies,
  "/companies.csv": PATHS.companiesCsv,
  "/blog": PATHS.blog,
  "/changes": PATHS.changes,
  "/map": PATHS.map,
  "/map.geojson": PATHS.mapGeojson,
  "/map-points.json": PATHS.mapPoints,
  "/flags": PATHS.flags,
  "/flags.csv": PATHS.flagsCsv,
  "/search": PATHS.search,
  "/methodology": PATHS.methodology,
};

function legacyTarget(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (SIMPLE[path]) return SIMPLE[path];
  const [, section, ...rest] = path.split("/");
  const tail = rest.map((s) => decodeURIComponent(s));
  if (section === "concessions") {
    if (tail[0] === "vid" && tail.length === 2)
      return tail[1]! in KIND_SLUGS ? kindHref(tail[1]!) : null;
    // /concessions/<slug>/json, /concessions/<slug>/documents/<key>, а при
    // номер, разцепен на "/" (221-72/07.10.2020) - целият остатък е номерът
    const docAt = tail.indexOf("documents");
    if (docAt > 0 && docAt === tail.length - 2) {
      const hit = resolveConcession(tail.slice(0, docAt).join("/"));
      return hit ? documentHref(hit.slug, tail[docAt + 1]!) : null;
    }
    if (tail.at(-1) === "json" && tail.length > 1) {
      const hit = resolveConcession(tail.slice(0, -1).join("/"));
      return hit ? concessionJsonHref(hit.slug) : null;
    }
    const hit = resolveConcession(tail.join("/"));
    return hit ? concessionHref(hit.slug) : null;
  }
  if (section === "grantors" && tail.length === 1) return grantorHref(tail[0]!);
  if (section === "companies" && tail.length === 1) {
    const name = getCompanyName(tail[0]!);
    return name ? companyHref(name, tail[0]!) : null;
  }
  if (section === "blog" && tail.length === 1) return blogHref(tail[0]!);
  return null;
}

export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  let target = legacyTarget(url.pathname);
  if (!target) throw new Response("Not Found", { status: 404 });
  // /concessions?kind=dam - направо на страницата на вида, не през /koncesii
  const kind = url.searchParams.get("kind");
  if (target === PATHS.concessions && kind && kind in KIND_SLUGS) {
    url.searchParams.delete("kind");
    target = kindHref(kind);
  }
  throw redirect(`${target}${url.search}`, 301);
}
