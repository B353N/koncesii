import { Link } from "react-router";
import { ConcessionsTable, ExportLinks, PageTitle } from "./components";
import { KIND_LABELS } from "./format";
import type { ConcessionRow } from "./queries.server";
import { kindHref as pathKindHref, PATHS } from "./paths";

/** Списъкът на партидите: общ за /concessions и /concessions/vid/:kind. */

export const PAGE_SIZE = 50;

export interface ListViewFilters {
  kind: string | null;
  status: string | null;
  flagged: boolean;
  q: string | null;
}

/** Филтрите от URL-а на списъка (без страницата). */
export function readListFilters(url: URL): ListViewFilters {
  return {
    kind: url.searchParams.get("kind"),
    status: url.searchParams.get("status"),
    flagged: url.searchParams.get("flagged") === "1",
    q: url.searchParams.get("q"),
  };
}

export function readPage(url: URL): number {
  return Math.max(1, Number(url.searchParams.get("page")) || 1);
}

/** Query string на филтрите; видът се включва само където адресът не го носи. */
export function filtersQuery(
  filters: ListViewFilters,
  { withKind }: { withKind: boolean },
): string {
  const params = new URLSearchParams();
  if (withKind && filters.kind) params.set("kind", filters.kind);
  if (filters.status) params.set("status", filters.status);
  if (filters.flagged) params.set("flagged", "1");
  if (filters.q) params.set("q", filters.q);
  return params.toString();
}

/** Адресът на страницата по вид обект. */
export function kindHref(kind: string): string {
  return pathKindHref(kind);
}

export function ConcessionsListView({
  rows,
  total,
  page,
  filters,
  basePath,
  title,
  count,
  intro,
}: {
  rows: ConcessionRow[];
  total: number;
  page: number;
  filters: ListViewFilters;
  /** "/koncesii" или "/koncesii/vid/<вид>" - носи пагинацията. */
  basePath: string;
  title: string;
  count?: React.ReactNode;
  intro?: React.ReactNode;
}) {
  const kindInPath = basePath !== PATHS.concessions;
  const qs = filtersQuery(filters, { withKind: !kindInPath });
  const csvQs = filtersQuery(filters, { withKind: true });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageTitle
        title={title}
        count={
          count ?? (
            <>
              {total} {total === 1 ? "резултат" : "резултата"}
              {filters.flagged && <> · само с индикатор</>}
              {page > 1 && (
                <>
                  {" "}
                  · страница {page} от {pages}
                </>
              )}
            </>
          )
        }
      />
      {intro}
      <nav
        className="mt-4 flex flex-wrap gap-2 text-[13px]"
        aria-label="По вид обект"
      >
        <FilterChip
          to={PATHS.concessions}
          active={!filters.kind && !filters.flagged}
        >
          Всички
        </FilterChip>
        {Object.entries(KIND_LABELS).map(([kind, label]) => (
          <FilterChip
            key={kind}
            to={kindHref(kind)}
            active={filters.kind === kind}
          >
            {label}
          </FilterChip>
        ))}
        <FilterChip to={`${basePath}?flagged=1`} active={filters.flagged}>
          С индикатор
        </FilterChip>
      </nav>
      <ExportLinks
        csvHref={`${PATHS.concessionsCsv}${csvQs ? "?" + csvQs : ""}`}
      />
      <ConcessionsTable rows={rows} />
      {pages > 1 && (
        <nav
          className="mt-4 flex flex-wrap items-center gap-2 font-mono text-[13px]"
          aria-label="Страници"
        >
          {pageWindow(page, pages).map((p, i) =>
            p === null ? (
              <span key={`gap-${i}`} className="px-1 text-stone">
                …
              </span>
            ) : (
              <Link
                key={p}
                to={pageHref(basePath, qs, p)}
                aria-current={p === page ? "page" : undefined}
                className={
                  p === page
                    ? "border border-water px-2.5 py-1 text-water"
                    : "border border-limestone px-2.5 py-1 text-stone hover:border-water hover:text-water"
                }
              >
                {p}
              </Link>
            ),
          )}
        </nav>
      )}
    </>
  );
}

/** Страница 1 е чистият адрес (същият като canonical). */
function pageHref(basePath: string, qs: string, page: number): string {
  const parts = [qs, page > 1 ? `page=${page}` : ""].filter(Boolean);
  return parts.length ? `${basePath}?${parts.join("&")}` : basePath;
}

/** 1 … 8 9 [10] 11 12 … 32 - компактна пагинация и на мобилен. */
export function pageWindow(
  current: number,
  total: number,
): Array<number | null> {
  const wanted = new Set([1, 2, total - 1, total]);
  for (let p = current - 2; p <= current + 2; p++) wanted.add(p);
  const pages = [...wanted]
    .filter((p) => p >= 1 && p <= total)
    .sort((a, b) => a - b);
  const out: Array<number | null> = [];
  for (const p of pages) {
    const prev = out[out.length - 1];
    if (typeof prev === "number" && p - prev > 1) out.push(null);
    out.push(p);
  }
  return out;
}

function FilterChip({
  to,
  active,
  children,
}: {
  to: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className={
        active
          ? "rounded-[2px] border border-water bg-[#eef3f0] px-2.5 py-1 text-water no-underline"
          : "rounded-[2px] border border-limestone bg-raised px-2.5 py-1 text-ink/80 no-underline hover:border-water hover:text-water"
      }
    >
      {children}
    </Link>
  );
}
