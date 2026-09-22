import type { Route } from "./+types/company-detail";
import {
  Breadcrumbs,
  ConcessionsTable,
  PageTitle,
  type Crumb,
} from "../components";
import { fmtEur, KIND_LABELS } from "../format";
import { breadcrumbJsonLd, itemListJsonLd, jsonLdScript } from "../jsonLd";
import { getCompany } from "../queries.server";
import {
  absUrl,
  clampDescription,
  entityTitle,
  pageTitle,
  sentence,
} from "../seo";
import { concessionHref } from "../slug";

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: pageTitle("Компания") }];
  const { company, concessions } = loaderData;
  const annual = concessions.reduce(
    (sum, c) =>
      c.annual_payment_eur != null ? sum + c.annual_payment_eur : sum,
    0,
  );
  const hasAnnual = concessions.some((c) => c.annual_payment_eur != null);
  const grantors = [
    ...new Set(concessions.map((c) => c.grantor_name).filter(Boolean)),
  ].slice(0, 3) as string[];
  const kinds = [
    ...new Set(concessions.map((c) => c.object_kind).filter(Boolean)),
  ]
    .map((k) => (KIND_LABELS[k as string] ?? k) as string)
    .slice(0, 4);
  const n = concessions.length;
  const description = clampDescription(
    sentence([
      `${company.name}${company.eik ? `, ЕИК ${company.eik}` : ""}:`,
      `${n} ${n === 1 ? "концесия" : "концесии"} по регистрите`,
      kinds.length ? `(${kinds.join(", ").toLowerCase()})` : null,
      hasAnnual ? `· ${fmtEur(annual)} годишно възнаграждение общо.` : ".",
      grantors.length ? `Концеденти: ${grantors.join(", ")}.` : null,
      "Всяка партида е проследима до официалния източник.",
    ]),
  );
  const title = entityTitle(
    company.name,
    `${company.eik ? `(ЕИК ${company.eik}) ` : ""}— концесии по регистрите`,
    90,
  );
  const url = absUrl(`/companies/${encodeURIComponent(company.eik ?? "")}`);
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
  const result = getCompany(params.eik);
  if (!result) throw new Response("Not Found", { status: 404 });
  return result;
}

export default function CompanyDetail({ loaderData }: Route.ComponentProps) {
  const { company, concessions } = loaderData;
  const crumbs: Crumb[] = [
    { label: "Начало", to: "/" },
    { label: "Компании", to: "/companies" },
    { label: company.name },
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
            "@type": "Organization",
            name: company.name,
            ...(company.eik
              ? {
                  identifier: {
                    "@type": "PropertyValue",
                    propertyID: "ЕИК",
                    value: company.eik,
                  },
                  url: absUrl(`/companies/${company.eik}`),
                }
              : {}),
            ...(company.address ? { address: company.address } : {}),
          },
          itemListJsonLd(
            concessions.slice(0, 50).map((c) => absUrl(concessionHref(c.slug))),
          ),
        ])}
      />
      <PageTitle
        title={company.name}
        count={
          <>
            концесионер · <span className="font-mono">ЕИК {company.eik}</span> ·{" "}
            {concessions.length}{" "}
            {concessions.length === 1 ? "концесия" : "концесии"}
            {company.address && <> · {company.address}</>}
          </>
        }
      />
      <div className="mt-3">
        <ConcessionsTable rows={concessions} />
      </div>
    </>
  );
}
