import type { Route } from "./+types/concessions-kind";
import { Breadcrumbs, DataPending, type Crumb } from "../components";
import {
  ConcessionsListView,
  kindHref,
  PAGE_SIZE,
  readListFilters,
  readPage,
} from "../concessions-list";
import {
  fmtEur,
  KIND_LABELS,
  KIND_PAGE_INTROS,
  KIND_PAGE_TITLES,
} from "../format";
import { getSummary, kindStats, listConcessions } from "../queries.server";
import { absUrl, pagedLinkDescriptors, pagedMeta, pageTitle } from "../seo";
import { breadcrumbJsonLd, itemListJsonLd, jsonLdScript } from "../jsonLd";
import { concessionHref } from "../slug";

/**
 * /concessions/vid/:kind - страница по вид обект (язовири, плажове, добив…).
 * Същият списък като /concessions, но със свой адрес, заглавие и уводен
 * абзац с числата от базата, за да е самостоятелна страница за търсачките,
 * а не "дубликат на /concessions с филтър".
 */

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: pageTitle("Концесии") }];
  const { kind, total, page, stats } = loaderData;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const paged = pagedMeta(kindHref(kind), page, pages);
  const heading = KIND_PAGE_TITLES[kind] ?? `Концесии: ${kind}`;
  const suffix = paged.pageLabel ? `, ${paged.pageLabel}` : "";
  const desc =
    `${KIND_PAGE_INTROS[kind] ?? ""} ${stats.total} партиди от ${stats.grantors} концеденти` +
    (stats.flagged ? `, ${stats.flagged} с индикатор за риск.` : ".") +
    (paged.pageLabel ? ` Страница ${page} от ${pages}.` : "");
  return [
    { title: pageTitle(`${heading} в България${suffix}`) },
    { name: "description", content: desc.trim() },
    { property: "og:title", content: `${heading} в България` },
    { property: "og:description", content: desc.trim() },
    { property: "og:url", content: paged.canonical },
    ...pagedLinkDescriptors(paged),
  ];
}

export function loader({ params, request }: Route.LoaderArgs) {
  const kind = params.kind;
  if (!(kind in KIND_LABELS)) throw new Response("Not Found", { status: 404 });
  const url = new URL(request.url);
  const filters = { ...readListFilters(url), kind };
  const page = readPage(url);
  const { rows, total } = listConcessions({
    ...filters,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  return {
    kind,
    rows,
    total,
    page,
    filters,
    stats: kindStats(kind),
    hasDb: getSummary() !== null,
  };
}

function years(months: number | null): string {
  if (months == null) return "—";
  return `${Math.round(months / 12)} г.`;
}

export default function ConcessionsByKind({
  loaderData,
}: Route.ComponentProps) {
  const { kind, rows, total, page, filters, stats, hasDb } = loaderData;
  if (!hasDb) return <DataPending />;
  const heading = KIND_PAGE_TITLES[kind] ?? `Концесии: ${kind}`;
  const crumbs: Crumb[] = [
    { label: "Начало", to: "/" },
    { label: "Концесии", to: "/concessions" },
    { label: KIND_LABELS[kind] ?? kind },
  ];

  return (
    <>
      <Breadcrumbs items={crumbs} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript([
          breadcrumbJsonLd(crumbs),
          itemListJsonLd(
            rows.map((r) => absUrl(concessionHref(r.slug))),
            { startIndex: (page - 1) * PAGE_SIZE + 1 },
          ),
        ])}
      />
      <ConcessionsListView
        rows={rows}
        total={total}
        page={page}
        filters={filters}
        basePath={kindHref(kind)}
        title={heading}
        count={
          <>
            {stats.total} {stats.total === 1 ? "партида" : "партиди"} ·{" "}
            {stats.grantors} {stats.grantors === 1 ? "концедент" : "концеденти"}
            {filters.flagged && <> · само с индикатор</>}
            {page > 1 && (
              <>
                {" "}
                · страница {page} от {Math.ceil(total / PAGE_SIZE)}
              </>
            )}
          </>
        }
        intro={
          <div className="mt-4 max-w-[70ch] text-[15px] leading-relaxed text-ink/90">
            <p>{KIND_PAGE_INTROS[kind]}</p>
            <p className="mt-2 text-stone">
              По регистрите: {stats.with_payment} от {stats.total} партиди имат
              вписано годишно възнаграждение
              {stats.annual_sum != null && stats.with_payment > 0 && (
                <> (общо {fmtEur(stats.annual_sum)} годишно)</>
              )}
              ; {stats.with_term} са със записан срок, среден срок{" "}
              {years(stats.avg_term_months)}; {stats.flagged}{" "}
              {stats.flagged === 1 ? "партида е" : "партиди са"} с поне един
              индикатор за риск по публичната методология. Всяко число води до
              партидата в източника.
            </p>
          </div>
        }
      />
    </>
  );
}
