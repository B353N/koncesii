import { Link } from "react-router";
import type { Route } from "./+types/changes";
import {
  Breadcrumbs,
  ConcessionsTable,
  DataPending,
  PageTitle,
  type Crumb,
} from "../components";
import { breadcrumbJsonLd, jsonLdScript } from "../jsonLd";
import { changeDates, getSummary, recentlyChanged } from "../queries.server";
import { absUrl, ogDescriptors, pageTitle } from "../seo";

/**
 * /changes - какво се е променило в регистрите при последните снемания.
 *
 * Страницата има две задачи: да отговори на „има ли нещо ново" без да се
 * рови в 1500 партиди, и да дава на търсачките една страница, която
 * наистина се променя при всяко обновяване на данните и сочи към
 * засегнатите партиди.
 */

const DESCRIPTION =
  "Какво се промени в регистрите на концесиите при последното обновяване: нови партиди, променени срокове, възнаграждения и документи, с дата на промяната.";

export function meta({ loaderData }: Route.MetaArgs) {
  const latest = loaderData?.dates[0];
  const description = latest
    ? `${DESCRIPTION} Последно обновяване: ${latest.changed_at}, засегнати ${latest.n} партиди.`
    : DESCRIPTION;
  return [
    { title: pageTitle("Промени в регистрите на концесиите") },
    { name: "description", content: description },
    ...ogDescriptors({
      title: "Промени в регистрите на концесиите",
      description,
      url: absUrl("/changes"),
    }),
    { tagName: "link" as const, rel: "canonical", href: absUrl("/changes") },
  ];
}

export function loader({}: Route.LoaderArgs) {
  return {
    rows: recentlyChanged(60),
    dates: changeDates().slice(0, 12),
    summary: getSummary(),
  };
}

export default function Changes({ loaderData }: Route.ComponentProps) {
  const { rows, dates, summary } = loaderData;
  if (!summary) return <DataPending />;
  const crumbs: Crumb[] = [{ label: "Начало", to: "/" }, { label: "Промени" }];
  const latest = dates[0];
  // Първото снемане маркира всичко като „ново“ - не е промяна, а старт.
  const firstDate = dates.length ? dates[dates.length - 1]!.changed_at : null;

  return (
    <>
      <Breadcrumbs items={crumbs} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript(breadcrumbJsonLd(crumbs))}
      />
      <PageTitle
        title="Промени"
        count={
          latest ? (
            <>
              последно обновяване {latest.changed_at} · {latest.n}{" "}
              {latest.n === 1 ? "засегната партида" : "засегнати партиди"}
            </>
          ) : (
            "проследяването на промените започва със следващото снемане"
          )
        }
      />

      <p className="mt-4 max-w-[70ch] text-[15px] leading-relaxed text-ink/90">
        При всяко снемане всяка партида се сверява с предишната публикувана база
        по съдържанието на страницата ѝ: заглавие, страни, срок, суми, обекти,
        документи и индикатори. Датата тук е на реалната промяна, не на
        снемането.{" "}
        <Link
          to="/methodology"
          className="text-water underline underline-offset-2"
        >
          Методология
        </Link>
      </p>

      {dates.length > 1 && (
        <div className="mt-5">
          <h2 className="font-display text-base font-bold">Снемания</h2>
          <ul className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[13px] tabular-nums">
            {dates.map((d) => (
              <li key={d.changed_at} className="text-stone">
                <b className="font-medium text-ink">{d.changed_at}</b> · {d.n}
                {d.changed_at === firstDate && (
                  <span className="ml-1 text-xs">(първо снемане)</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6">
        <h2 className="font-display text-base font-bold">
          Последно променени партиди
        </h2>
        {rows.length > 0 ? (
          <ConcessionsTable rows={rows} />
        ) : (
          <p className="mt-2 text-stone">
            Все още няма записани промени: проследяването започва със следващото
            снемане на регистрите.
          </p>
        )}
      </div>
    </>
  );
}
