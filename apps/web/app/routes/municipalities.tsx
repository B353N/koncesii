import { Link } from "react-router";
import type { Route } from "./+types/municipalities";
import { Breadcrumbs, DataPending, type Crumb } from "../components";
import { breadcrumbJsonLd, itemListJsonLd, jsonLdScript } from "../jsonLd";
import { municipalityHref, PATHS } from "../paths";
import { listMunicipalities } from "../queries.server";
import { absUrl, ogDescriptors, pageTitle } from "../seo";

const TITLE = "Концесии по общини в България";

export function meta({ loaderData }: Route.MetaArgs) {
  const n = loaderData?.rows.length ?? 0;
  const description = `Концесиите във всяка от ${n} общини: язовири, плажове, находища и имоти, концесионери и възнаграждения, по данните от Националния концесионен регистър.`;
  return [
    { title: pageTitle(TITLE) },
    { name: "description", content: description },
    ...ogDescriptors({
      title: TITLE,
      description,
      url: absUrl(PATHS.municipalities),
    }),
    {
      tagName: "link" as const,
      rel: "canonical",
      href: absUrl(PATHS.municipalities),
    },
  ];
}

export function loader({}: Route.LoaderArgs) {
  return listMunicipalities();
}

export default function Municipalities({ loaderData }: Route.ComponentProps) {
  const { rows, assigned, total } = loaderData;
  if (!total) return <DataPending />;
  const byOblast = new Map<string, typeof rows>();
  for (const r of rows)
    byOblast.set(r.oblast, [...(byOblast.get(r.oblast) ?? []), r]);
  const crumbs: Crumb[] = [{ label: "Начало", to: "/" }, { label: "Общини" }];
  return (
    <>
      <Breadcrumbs items={crumbs} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript([
          breadcrumbJsonLd(crumbs),
          itemListJsonLd(rows.map((r) => absUrl(municipalityHref(r.slug)))),
        ])}
      />
      <div className="pt-8">
        <h1 className="font-display text-3xl font-bold tracking-[-0.02em]">
          {TITLE}
        </h1>
        <p className="mt-2 max-w-[68ch] text-stone">
          {rows.length} общини, подредени по области. {assigned} от {total}{" "}
          партиди имат община: по обекта, по концедента или по предмета на
          концесията.
        </p>
      </div>
      <div className="mt-8 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
        {[...byOblast].map(([oblast, list]) => (
          <section key={oblast}>
            <h2 className="font-display text-base font-bold">
              Област {oblast}
            </h2>
            <ul className="mt-2">
              {list.map((r) => (
                <li
                  key={r.slug}
                  className="flex justify-between gap-3 border-b border-limestone py-1.5"
                >
                  <Link
                    to={municipalityHref(r.slug)}
                    className="font-semibold text-ink hover:text-water"
                  >
                    {r.name}
                  </Link>
                  <span className="text-[13.5px] text-stone tabular-nums">
                    {r.concessions}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
