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
import { getSummary, listConcessions } from "../queries.server";
import { pagedLinkDescriptors, pagedMeta, pageTitle } from "../seo";

const DESCRIPTION =
  "Всички концесии в България с филтри по вид, статус и индикатори. CSV експорт, всяка партида проследима до Националния концесионен регистър.";

export function meta({ loaderData }: Route.MetaArgs) {
  const page = loaderData?.page ?? 1;
  const pages = Math.max(1, Math.ceil((loaderData?.total ?? 0) / PAGE_SIZE));
  const paged = pagedMeta("/concessions", page, pages);
  const suffix = paged.pageLabel ? `, ${paged.pageLabel}` : "";
  return [
    { title: pageTitle(`Концесии в България${suffix}`) },
    {
      name: "description",
      content: paged.pageLabel
        ? `${DESCRIPTION} Страница ${page} от ${pages}.`
        : DESCRIPTION,
    },
    ...pagedLinkDescriptors(paged),
  ];
}

export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const filters = readListFilters(url);
  // Видът има собствена страница (/concessions/vid/:kind) със свой
  // canonical; старият ?kind= адрес е 301 към нея с останалите филтри.
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
    <ConcessionsListView
      rows={rows}
      total={total}
      page={page}
      filters={filters}
      basePath="/concessions"
      title="Концесии"
    />
  );
}
