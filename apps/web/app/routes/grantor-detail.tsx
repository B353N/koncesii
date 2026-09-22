import type { Route } from "./+types/grantor-detail";
import {
  Breadcrumbs,
  ConcessionsTable,
  PageTitle,
  type Crumb,
} from "../components";
import { fmtEur, KIND_LABELS } from "../format";
import { breadcrumbJsonLd, itemListJsonLd, jsonLdScript } from "../jsonLd";
import { getGrantor } from "../queries.server";
import {
  absUrl,
  clampDescription,
  entityTitle,
  pageTitle,
  sentence,
} from "../seo";
import { concessionHref } from "../slug";

const GRANTOR_KIND: Record<string, string> = {
  municipality: "община",
  minister: "министър",
  other: "орган",
};

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: pageTitle("Концедент") }];
  const { grantor, concessions } = loaderData;
  const n = concessions.length;
  const annual = concessions.reduce(
    (sum, c) =>
      c.annual_payment_eur != null ? sum + c.annual_payment_eur : sum,
    0,
  );
  const hasAnnual = concessions.some((c) => c.annual_payment_eur != null);
  const flagged = concessions.filter((c) => c.flags).length;
  const kinds = [
    ...new Set(concessions.map((c) => c.object_kind).filter(Boolean)),
  ]
    .map((k) => (KIND_LABELS[k as string] ?? k) as string)
    .slice(0, 4);
  const description = clampDescription(
    sentence([
      `${grantor.name} като концедент:`,
      `${n} ${n === 1 ? "концесия" : "концесии"} по регистрите`,
      kinds.length ? `(${kinds.join(", ").toLowerCase()})` : null,
      hasAnnual ? `· ${fmtEur(annual)} годишно възнаграждение общо.` : ".",
      flagged
        ? `${flagged} ${flagged === 1 ? "партида е" : "партиди са"} с индикатор за риск.`
        : null,
      "Срокове, възнаграждения и документи, проследими до официалния източник.",
    ]),
  );
  const title = entityTitle(
    `Концесии на ${grantor.name}`,
    `— срокове и възнаграждения`,
    90,
  );
  const url = absUrl(`/grantors/${encodeURIComponent(grantor.id.slice(3))}`);
  return [
    { title: pageTitle(title) },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: url },
    { tagName: "link" as const, rel: "canonical", href: url },
  ];
}

export function loader({ params }: Route.LoaderArgs) {
  const result = getGrantor(params.slug);
  if (!result) throw new Response("Not Found", { status: 404 });
  return result;
}

export default function GrantorDetail({ loaderData }: Route.ComponentProps) {
  const { grantor, concessions } = loaderData;
  const crumbs: Crumb[] = [
    { label: "Начало", to: "/" },
    { label: "Концеденти", to: "/grantors" },
    { label: grantor.name },
  ];
  return (
    <>
      <Breadcrumbs items={crumbs} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript([
          breadcrumbJsonLd(crumbs),
          {
            "@context": "https://schema.org",
            "@type": "GovernmentOrganization",
            name: grantor.name,
            url: absUrl(`/grantors/${encodeURIComponent(grantor.id.slice(3))}`),
          },
          itemListJsonLd(
            concessions.slice(0, 50).map((c) => absUrl(concessionHref(c.slug))),
          ),
        ])}
      />
      <PageTitle
        title={grantor.name}
        count={`${GRANTOR_KIND[grantor.kind] ?? "концедент"} · ${concessions.length} ${concessions.length === 1 ? "концесия" : "концесии"}`}
      />
      <div className="mt-3">
        <ConcessionsTable rows={concessions} showGrantor={false} />
      </div>
    </>
  );
}
