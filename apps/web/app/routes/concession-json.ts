import { redirect } from "react-router";
import type { Route } from "./+types/concession-json";
import { getConcession, resolveConcession } from "../queries.server";
import { concessionHref } from "../slug";

/** Resource route: /concessions/:slug/json - машинночетимият изглед. */
export function loader({ params }: Route.LoaderArgs) {
  const hit = resolveConcession(params.slug);
  if (!hit) throw new Response("Not Found", { status: 404 });
  if (hit.slug !== params.slug)
    throw redirect(`${concessionHref(hit.slug)}/json`, 301);
  const detail = getConcession(hit.reg_num);
  if (!detail) throw new Response("Not Found", { status: 404 });
  return Response.json({
    ...detail,
    flags: detail.flags.map((f) => ({ ...f, inputs: JSON.parse(f.inputs) })),
  });
}
