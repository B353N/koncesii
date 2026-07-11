import { SKILL_MD } from "../agent-skill.server";

/** Resource route: /.well-known/agent-skills/koncesii-data/SKILL.md */
export function loader() {
  return new Response(SKILL_MD, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
