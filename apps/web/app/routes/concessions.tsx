import { redirect } from "react-router";
import type { Route } from "./+types/concessions";
import { DataPending } from "../components";
import {
  ConcessionsListView,
  filtersQuery,
  kindHref,
  PAGE_SIZE,
  readListFilters,
  readPage,
} from "../concessions-list";
import { KIND_LABELS } from "../format";
import { getSummary, listConcessions } from "../queries.server";
import {
  absUrl,
  ogDescriptors,
  pagedLinkDescriptors,
  pagedMeta,
  pageTitle,
} from "../seo";
import { itemListJsonLd, jsonLdScript } from "../jsonLd";
import { concessionHref } from "../slug";

const DESCRIPTION =
  "Всички концесии в България с филтри по вид, статус и индикатори. CSV експорт, всяка партида проследима до Националния концесионен регистър.";

export function meta({ loaderData }: Route.MetaArgs) {
  const page = loaderData?.page ?? 1;
  const pages = Math.max(1, Math.ceil((loaderData?.total ?? 0) / PAGE_SIZE));
  const paged = pagedMeta("/concessions", page, pages);
  const suffix = paged.pageLabel ? `, ${paged.pageLabel}` : "";
  const title = `Концесии в България${suffix}`;
  const description = paged.pageLabel
    ? `${DESCRIPTION} Страница ${page} от ${pages}.`
    : DESCRIPTION;
  return [
    { title: pageTitle(title) },
    { name: "description", content: description },
    ...ogDescriptors({ title, description, url: paged.canonical }),
    ...pagedLinkDescriptors(paged),
  ];
}

export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const filters = readListFilters(url);
  // Видът има собствена страница (/concessions/vid/:kind) със свой
  // canonical; старият ?kind= адрес е 301 към нея с останалите филтри.
  // Непознат вид е 404 още тук, вместо 301 към страница, която пак е 404.
  if (filters.kind && !(filters.kind in KIND_LABELS))
    throw new Response("Not Found", { status: 404 });
  if (filters.kind) {
    const rest = filtersQuery(filters, { withKind: false });
    const page = readPage(url);
    const parts = [rest, page > 1 ? `page=${page}` : ""].filter(Boolean);
    throw redirect(
      `${kindHref(filters.kind)}${parts.length ? "?" + parts.join("&") : ""}`,
      301,
    );
  }
  const page = readPage(url);
  const { rows, total } = listConcessions({
    ...filters,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  return { rows, total, page, filters, hasDb: getSummary() !== null };
}

export default function Concessions({ loaderData }: Route.ComponentProps) {
  const { rows, total, page, filters, hasDb } = loaderData;
  if (!hasDb) return <DataPending />;
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript(
          itemListJsonLd(
            rows.map((r) => absUrl(concessionHref(r.slug))),
            { startIndex: (page - 1) * PAGE_SIZE + 1 },
          ),
        )}
      />
      <ConcessionsListView
        rows={rows}
        total={total}
        page={page}
        filters={filters}
        basePath="/concessions"
        title="Концесии"
      />
    </>
  );
}
