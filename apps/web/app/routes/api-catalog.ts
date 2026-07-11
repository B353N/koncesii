/**
 * Resource route: /.well-known/api-catalog (RFC 9727) — linkset (RFC 9264),
 * който сочи агентите към реалните машинночетими ресурси на сайта:
 * OpenAPI описанието, методологията и status endpoint-а. Рекламира се и
 * с Link хедър на HTML отговорите (entry.server.tsx).
 */

const BASE = "https://koncesii.com";

const LINKSET = {
  linkset: [
    {
      anchor: `${BASE}/`,
      "service-desc": [
        {
          href: `${BASE}/openapi.json`,
          type: "application/json",
          title: "OpenAPI 3.1 — публичните данни endpoint-и",
        },
      ],
      "service-doc": [
        {
          href: `${BASE}/methodology`,
          type: "text/html",
          title: "Методология на индикаторите за риск",
        },
        {
          href: "https://github.com/B353N/koncesii",
          type: "text/html",
          title: "Отворен код, документация и модел на данните",
        },
      ],
      status: [{ href: `${BASE}/healthz`, type: "application/json" }],
    },
  ],
} as const;

export function loader() {
  return new Response(JSON.stringify(LINKSET, null, 2) + "\n", {
    headers: {
      "Content-Type": "application/linkset+json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
