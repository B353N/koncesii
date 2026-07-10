import { Link } from "react-router";
import type { Route } from "./+types/concessions";
import {
  ConcessionsTable,
  DataPending,
  ExportLinks,
  PageTitle,
} from "../components";
import { KIND_LABELS } from "../format";
import { getSummary, listConcessions } from "../queries.server";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Концесии — КОНЦЕСИИ" },
    {
      name: "description",
      content:
        "Всички концесии в България с филтри по вид, статус и индикатори. CSV експорт, всяка партида проследима до Националния концесионен регистър.",
    },
    {
      tagName: "link",
      rel: "canonical",
      href: "https://koncesii.com/concessions",
    },
  ];
}

const PAGE = 50;

export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const filters = {
    kind: url.searchParams.get("kind"),
    status: url.searchParams.get("status"),
    flagged: url.searchParams.get("flagged") === "1",
    q: url.searchParams.get("q"),
  };
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const { rows, total } = listConcessions({
    ...filters,
    limit: PAGE,
    offset: (page - 1) * PAGE,
  });
  return { rows, total, page, filters, hasDb: getSummary() !== null };
}

export default function Concessions({ loaderData }: Route.ComponentProps) {
  const { rows, total, page, filters, hasDb } = loaderData;
  if (!hasDb) return <DataPending />;

  const params = new URLSearchParams();
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.status) params.set("status", filters.status);
  if (filters.flagged) params.set("flagged", "1");
  if (filters.q) params.set("q", filters.q);
  const qs = params.toString();
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <>
      <PageTitle
        title="Концесии"
        count={
          <>
            {total} {total === 1 ? "резултат" : "резултата"}
            {filters.kind && (
              <> · вид: {KIND_LABELS[filters.kind] ?? filters.kind}</>
            )}
            {filters.flagged && <> · само с индикатор</>}
          </>
        }
      />
      <div className="mt-4 flex flex-wrap gap-2 text-[13px]">
        <FilterChip
          to="/concessions"
          active={!filters.kind && !filters.flagged}
        >
          Всички
        </FilterChip>
        {Object.entries(KIND_LABELS).map(([kind, label]) => (
          <FilterChip
            key={kind}
            to={`/concessions?kind=${kind}`}
            active={filters.kind === kind}
          >
            {label}
          </FilterChip>
        ))}
        <FilterChip to="/concessions?flagged=1" active={filters.flagged}>
          С индикатор
        </FilterChip>
      </div>
      <ExportLinks csvHref={`/concessions.csv${qs ? "?" + qs : ""}`} />
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
                to={`/concessions?${qs ? qs + "&" : ""}page=${p}`}
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

/** 1 … 8 9 [10] 11 12 … 32 — компактна пагинация и на мобилен. */
function pageWindow(current: number, total: number): Array<number | null> {
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
