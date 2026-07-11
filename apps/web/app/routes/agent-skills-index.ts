import { SKILL_DIGEST, SKILL_NAME } from "../agent-skill.server";

/**
 * Resource route: /.well-known/agent-skills/index.json —
 * Agent Skills Discovery RFC v0.2.0. Един skill: как се четат данните.
 */
export function loader() {
  const index = {
    $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    skills: [
      {
        name: SKILL_NAME,
        type: "skill-md",
        description:
          "Query Bulgaria's public concession registry on koncesii.com: data endpoints, risk indicator semantics, quality flags and provenance rules.",
        url: `/.well-known/agent-skills/${SKILL_NAME}/SKILL.md`,
        digest: SKILL_DIGEST,
      },
    ],
  };
  return new Response(JSON.stringify(index, null, 2) + "\n", {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
