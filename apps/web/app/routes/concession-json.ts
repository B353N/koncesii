import type { Route } from "./+types/concession-json";
import { getConcession } from "../queries.server";

/** Resource route: /concessions/:regNum/json — машинночетимият изглед. */
export function loader({ params }: Route.LoaderArgs) {
  const detail = getConcession(params.regNum);
  if (!detail) throw new Response("Not Found", { status: 404 });
  return Response.json({
    ...detail,
    flags: detail.flags.map((f) => ({ ...f, inputs: JSON.parse(f.inputs) })),
  });
}
