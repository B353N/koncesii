import { Link } from "react-router";
import type { Route } from "./+types/home";
import { POSTS, postMeta } from "../blog/posts";
import { kindHref } from "../concessions-list";
import { absUrl, ogDescriptors } from "../seo";
import { concessionHref } from "../slug";
import { DataPending } from "../components";
import {
  FLAG_DESCRIPTIONS,
  FLAG_SHORT,
  fmtMonths,
  fmtPercent,
  KIND_LABELS,
  SEVERITY_RANK,
} from "../format";
import { FlagPin, MapApp } from "../map-app";
import type { RouteHandle } from "../root";
import {
  flagCodeCounts,
  getSummary,
  kindCounts,
  listMunicipalities,
  lowestPaymentRatio,
  mapPoints,
  topByTerm,
  topGrantors,
} from "../queries.server";
import {
  blogHref,
  flagHref,
  grantorHref,
  municipalityHref,
  PATHS,
} from "../paths";

export const handle: RouteHandle = { fullBleed: true };

// „регистър концесии" и „регистър на концесиите" са заявките, по които
// началната страница вече е на позиция 7-8 в Google (GSC, 25.09.2026)
const TITLE = "Регистър на концесиите в България - карта и данни | КОНЦЕСИИ";
const DESCRIPTION =
  "Регистърът на концесиите в България на карта: морски плажове, находища, язовири и имоти. Кой ги държи, за колко години и срещу какво възнаграждение, с връзка към Националния концесионен регистър.";

export function meta({}: Route.MetaArgs) {
  return [
    { title: TITLE },
    { name: "description", content: DESCRIPTION },
    ...ogDescriptors({
      title: TITLE,
      description: DESCRIPTION,
      url: absUrl("/"),
    }),
    { tagName: "link", rel: "canonical", href: "https://koncesii.com/" },
  ];
}

/** Колко партиди списъкът до картата рендира на сървъра. */
const INITIAL_LIST = 40;

export function loader({}: Route.LoaderArgs) {
  const points = mapPoints();
  const onMap = new Map<string, number>();
  for (const p of points) onMap.set(p.kind, (onMap.get(p.kind) ?? 0) + 1);
  return {
    summary: getSummary(),
    initial: points.slice(0, INITIAL_LIST),
    geocoded: points.length,
    mapKinds: [...onMap]
      .map(([kind, n]) => ({ kind, n }))
      .sort((a, b) => b.n - a.n),
    kinds: kindCounts(),
    flagCounts: flagCodeCounts(),
    longest: topByTerm(5),
    lowest: lowestPaymentRatio(5),
    grantors: topGrantors(10),
    municipalities: listMunicipalities()
      .rows.sort((a, b) => b.concessions - a.concessions)
      .slice(0, 18),
    posts: POSTS.slice(0, 3).map(postMeta),
  };
}

const nf = new Intl.NumberFormat("bg-BG");

export default function Home({ loaderData }: Route.ComponentProps) {
  const {
    summary,
    initial,
    geocoded,
    mapKinds,
    kinds,
    flagCounts,
    longest,
    lowest,
    grantors,
    municipalities,
    posts,
  } = loaderData;
  if (!summary)
    return (
      <div className="mx-auto max-w-5xl px-5">
        <DataPending />
      </div>
    );

  return (
    <>
      <MapApp
        heading={
          <h1 className="font-display text-[25px] leading-[1.2] font-bold tracking-[-0.02em] text-balance">
            Концесиите в България на една карта
          </h1>
        }
        intro={
          <p>
            {nf.format(summary.concessions)} партиди от Националния концесионен
            регистър. Червеното флагче е индикатор с висока тежест, оранжевото
            със средна, сивото с ниска.
          </p>
        }
        initial={initial}
        kinds={mapKinds}
        geocoded={geocoded}
        total={summary.concessions}
      />

      <section className="bg-ink text-white" aria-label="Регистърът в числа">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-4 py-12 sm:px-6 md:grid-cols-4">
          {(
            [
              [summary.concessions, "концесии в регистъра", PATHS.concessions],
              [summary.concessionaires, "концесионери", PATHS.companies],
              [summary.grantors, "концеденти", PATHS.grantors],
              [summary.flagged, "партиди с поне един индикатор", PATHS.flags],
            ] as const
          ).map(([n, label, to]) => (
            <Link key={to} to={to} className="group text-white no-underline">
              <b className="block font-display text-[clamp(30px,3.4vw,46px)] font-bold tracking-[-0.03em]">
                {nf.format(n)}
              </b>
              <span className="text-[#aab6bf] group-hover:text-white">
                {label}
              </span>
            </Link>
          ))}
        </div>
        <p className="mx-auto max-w-6xl px-4 pb-8 text-[13px] text-[#aab6bf] sm:px-6">
          Данни към {summary.data_date}
        </p>
      </section>

      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <section>
          <h2 className="font-display text-2xl font-bold tracking-[-0.02em]">
            Какво означават флагчетата
          </h2>
          <p className="mt-1.5 mb-7 text-stone">
            Всеки индикатор е аритметичен факт, изчислен по{" "}
            <Link to={PATHS.methodology} className="text-water underline">
              публична методология
            </Link>
            . Не е обвинение.
          </p>
          <ul className="grid grid-cols-2 gap-3.5 md:grid-cols-3 lg:grid-cols-5">
            {flagCounts.map((f) => (
              <li key={f.code}>
                <Link
                  to={flagHref(f.code)}
                  className="block h-full rounded-2xl border-[1.5px] border-transparent bg-raised p-5 text-ink no-underline hover:border-ink"
                >
                  <FlagPin sev={SEVERITY_RANK[f.severity] ?? 1} />
                  <b className="mt-3 block font-display text-[30px] font-bold">
                    {nf.format(f.n)}
                  </b>
                  <span className="font-bold">
                    {FLAG_SHORT[f.code] ?? f.code}
                  </span>
                  <span className="mt-1 block text-[13.5px] text-stone">
                    {FLAG_DESCRIPTIONS[f.code]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <div className="mt-16 grid gap-12 md:grid-cols-2">
          <section>
            <h2 className="font-display text-2xl font-bold tracking-[-0.02em]">
              По вид обект
            </h2>
            <p className="mt-1.5 mb-4 text-stone">Всички партиди в регистъра</p>
            <ul>
              {kinds.map((k) => (
                <li key={k.kind}>
                  <Link to={kindHref(k.kind)} className={ROW}>
                    <span>{KIND_LABELS[k.kind] ?? k.kind}</span>
                    <span className="text-stone tabular-nums">{k.n}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="font-display text-2xl font-bold tracking-[-0.02em]">
              Кой отдава най-много
            </h2>
            <p className="mt-1.5 mb-4 text-stone">Концеденти по брой партиди</p>
            <ul>
              {grantors.map((g) => (
                <li key={g.slug}>
                  <Link to={grantorHref(g.slug)} className={ROW}>
                    <span className="truncate">{g.name}</span>
                    <span className="text-stone tabular-nums">
                      {g.concessions}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <Link
              to={PATHS.grantors}
              className="mt-3 inline-block font-semibold text-water"
            >
              Всички концеденти
            </Link>
          </section>
        </div>

        <section className="mt-16">
          <h2 className="font-display text-2xl font-bold tracking-[-0.02em]">
            Концесии по общини
          </h2>
          <p className="mt-1.5 mb-4 text-stone">
            Общините с най-много концесии по регистрите
          </p>
          <ul className="grid gap-x-10 sm:grid-cols-2 lg:grid-cols-3">
            {municipalities.map((m) => (
              <li key={m.slug}>
                <Link to={municipalityHref(m.slug)} className={ROW}>
                  <span>
                    {m.name}{" "}
                    <span className="font-normal text-stone">
                      обл. {m.oblast}
                    </span>
                  </span>
                  <span className="text-stone tabular-nums">
                    {m.concessions}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Link
            to={PATHS.municipalities}
            className="mt-3 inline-block font-semibold text-water"
          >
            Всички общини
          </Link>
        </section>

        <section className="mt-16">
          <h2 className="font-display text-2xl font-bold tracking-[-0.02em]">
            Анализи
          </h2>
          <p className="mt-1.5 mb-6 text-stone">
            Какво казват данните, с числа от самата база
          </p>
          <ul className="grid gap-3.5 md:grid-cols-3">
            {posts.map((p) => (
              <li key={p.slug}>
                <Link
                  to={blogHref(p.slug)}
                  className="block h-full rounded-2xl bg-raised p-5 text-ink no-underline hover:shadow-[inset_0_0_0_1.5px_var(--color-ink)]"
                >
                  <b className="block text-[17px] leading-snug">{p.title}</b>
                  <span className="mt-1.5 block text-[14px] text-stone">
                    {p.lead}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Link
            to={PATHS.blog}
            className="mt-4 inline-block font-semibold text-water"
          >
            Всички анализи
          </Link>
        </section>

        <div className="mt-16 grid gap-12 md:grid-cols-2">
          <RankTable
            title="Най-дълги срокове"
            sub="Концесии, подредени по договорен срок"
            rows={longest.map((c) => ({
              slug: c.slug,
              title: c.headline,
              raw: c.title,
              grantor: c.grantor_name,
              value: fmtMonths(c.term_months),
            }))}
          />
          <RankTable
            title="Най-ниски възнаграждения"
            sub="Годишното възнаграждение като % от стойността"
            rows={lowest.map((c) => ({
              slug: c.slug,
              title: c.headline,
              raw: c.title,
              grantor: c.grantor_name,
              value: fmtPercent(c.ratio),
            }))}
          />
        </div>
      </div>
    </>
  );
}

const ROW =
  "flex justify-between gap-4 border-b border-limestone py-2.5 font-semibold text-ink no-underline hover:text-water";

function RankTable({
  title,
  sub,
  rows,
}: {
  title: string;
  sub: string;
  rows: Array<{
    slug: string;
    title: string;
    raw: string;
    grantor: string | null;
    value: string;
  }>;
}) {
  return (
    <section>
      <h2 className="font-display text-2xl font-bold tracking-[-0.02em]">
        {title}
      </h2>
      <p className="mt-1.5 mb-4 text-stone">{sub}</p>
      <ul>
        {rows.map((r) => (
          <li
            key={r.slug}
            className="flex justify-between gap-4 border-b border-limestone py-2.5"
          >
            <span className="min-w-0">
              <Link
                to={concessionHref(r.slug)}
                className="line-clamp-2 font-semibold text-ink no-underline hover:text-water hover:underline"
                title={r.raw}
              >
                {r.title}
              </Link>
              {r.grantor && (
                <span className="block text-[13px] text-stone">
                  {r.grantor}
                </span>
              )}
            </span>
            <span className="font-mono text-[14px] whitespace-nowrap tabular-nums">
              {r.value}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
