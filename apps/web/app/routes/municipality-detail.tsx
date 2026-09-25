import { Link } from "react-router";
import type { Route } from "./+types/municipality-detail";
import { Breadcrumbs, ConcessionsTable, type Crumb } from "../components";
import { fmtEur, KIND_LABELS } from "../format";
import { breadcrumbJsonLd, itemListJsonLd, jsonLdScript } from "../jsonLd";
import {
  companyHref,
  concessionHref,
  kindHref,
  municipalityHref,
  PATHS,
} from "../paths";
import { isPlaceholderName, withoutEgn } from "../municipality";
import { getMunicipality, type ConcessionRow } from "../queries.server";
import {
  absUrl,
  clampDescription,
  ogDescriptors,
  pageTitle,
  sentence,
} from "../seo";

/**
 * /obshtini/:slug - концесиите в една община. Отговаря на търсенията по
 * място („концесии Созопол", „язовир Михалково"): числата, видовете,
 * концесионерите и назованите населени места идват от партидите;
 * как е определена общината пише на страницата (municipality.ts).
 */

/** Видът обект в множествено число, за изречения („12 язовира"). */
const KIND_PLURAL: Record<string, [string, string]> = {
  dam: ["язовир", "язовира"],
  beach: ["морски плаж", "морски плажа"],
  mining: ["находище", "находища"],
  quarry: ["кариера", "кариери"],
  mineral_water: ["минерална вода", "минерални води"],
  port: ["пристанище", "пристанища"],
  infrastructure: ["инфраструктурен обект", "инфраструктурни обекта"],
  property: ["имот", "имота"],
  service: ["услуга", "услуги"],
  other: ["друг обект", "други обекта"],
};
const KIND_TITLE_WORD: Record<string, string> = {
  dam: "язовири",
  beach: "плажове",
  mining: "находища",
  quarry: "кариери",
  mineral_water: "минерални води",
  port: "пристанища",
  property: "имоти",
};

function stats(rows: ConcessionRow[]) {
  const kinds = new Map<string, number>();
  for (const r of rows)
    if (r.object_kind)
      kinds.set(r.object_kind, (kinds.get(r.object_kind) ?? 0) + 1);
  const withAnnual = rows.filter((r) => r.annual_payment_eur != null);
  const companies = new Map<
    string,
    { name: string; eik: string | null; n: number }
  >();
  for (const r of rows)
    if (r.concessionaire_name && !isPlaceholderName(r.concessionaire_name)) {
      const name = withoutEgn(r.concessionaire_name);
      const key = r.eik ?? name;
      const c = companies.get(key) ?? {
        name,
        eik: r.eik,
        n: 0,
      };
      c.n++;
      companies.set(key, c);
    }
  const grantors = new Map<string, number>();
  for (const r of rows)
    if (r.grantor_name)
      grantors.set(r.grantor_name, (grantors.get(r.grantor_name) ?? 0) + 1);
  return {
    kinds: [...kinds].sort((a, b) => b[1] - a[1]),
    annual: withAnnual.reduce((s, r) => s + r.annual_payment_eur!, 0),
    withAnnual: withAnnual.length,
    flagged: rows.filter((r) => r.flags).length,
    companies: [...companies.values()].sort((a, b) => b.n - a.n),
    grantors: [...grantors].sort((a, b) => b[1] - a[1]),
  };
}

function kindPhrase([kind, n]: [string, number]): string {
  const [one, many] = KIND_PLURAL[kind] ?? ["обект", "обекта"];
  return `${n} ${n === 1 ? one : many}`;
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: pageTitle("Община") }];
  const { municipality: m, concessions } = loaderData;
  const s = stats(concessions);
  const words = s.kinds
    .map(([k]) => KIND_TITLE_WORD[k])
    .filter(Boolean)
    .slice(0, 2);
  const title = `Концесии в община ${m.name}${words.length ? ` - ${words.join(" и ")}` : ""}`;
  const description = clampDescription(
    sentence([
      `${concessions.length} ${concessions.length === 1 ? "концесия" : "концесии"} в община ${m.name}, област ${m.oblast}:`,
      `${s.kinds.map(kindPhrase).join(", ")}.`,
      s.companies.length
        ? `Концесионери: ${s.companies
            .slice(0, 3)
            .map((c) => c.name)
            .join(", ")}.`
        : null,
      s.withAnnual
        ? `Вписано годишно възнаграждение общо ${fmtEur(s.annual)}.`
        : null,
      m.settlements.length
        ? `Населени места: ${m.settlements.slice(0, 5).join(", ")}.`
        : null,
      "Срокове, възнаграждения и индикатори, с връзка към Националния концесионен регистър.",
    ]),
  );
  const url = absUrl(municipalityHref(m.slug));
  return [
    { title: pageTitle(title) },
    { name: "description", content: description },
    ...ogDescriptors({ title, description, url }),
    { tagName: "link" as const, rel: "canonical", href: url },
  ];
}

export function loader({ params }: Route.LoaderArgs) {
  const result = getMunicipality(params.slug);
  if (!result) throw new Response("Not Found", { status: 404 });
  return result;
}

export default function MunicipalityDetail({
  loaderData,
}: Route.ComponentProps) {
  const { municipality: m, concessions, neighbours } = loaderData;
  const s = stats(concessions);
  const crumbs: Crumb[] = [
    { label: "Начало", to: "/" },
    { label: "Общини", to: PATHS.municipalities },
    { label: `Община ${m.name}` },
  ];
  const n = concessions.length;
  return (
    <>
      <Breadcrumbs items={crumbs} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript([
          breadcrumbJsonLd(crumbs),
          {
            "@context": "https://schema.org",
            "@type": "AdministrativeArea",
            name: `Община ${m.name}`,
            url: absUrl(municipalityHref(m.slug)),
            containedInPlace: {
              "@type": "AdministrativeArea",
              name: `Област ${m.oblast}`,
            },
          },
          itemListJsonLd(
            concessions.slice(0, 50).map((c) => absUrl(concessionHref(c.slug))),
          ),
        ])}
      />

      <div className="pt-8">
        <h1 className="font-display text-3xl font-bold tracking-[-0.02em] text-balance">
          Концесии в община {m.name}
        </h1>
        <p className="mt-1 text-stone">област {m.oblast}</p>
      </div>

      <p className="mt-5 max-w-[72ch] text-[16px] leading-relaxed">
        В община {m.name} има {n} {n === 1 ? "концесия" : "концесии"} по
        регистрите: {s.kinds.map(kindPhrase).join(", ")}.
        {s.grantors.length > 0 &&
          ` Концеденти: ${s.grantors
            .slice(0, 3)
            .map(([g, c]) => `${g} (${c})`)
            .join(", ")}.`}
        {s.withAnnual > 0 &&
          ` Вписаното годишно възнаграждение е общо ${fmtEur(s.annual)} по ${s.withAnnual} ${s.withAnnual === 1 ? "партида" : "партиди"}.`}
        {s.flagged > 0 &&
          ` ${s.flagged} ${s.flagged === 1 ? "партида е" : "партиди са"} с индикатор за риск.`}
      </p>

      <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            [String(n), n === 1 ? "концесия" : "концесии"],
            [String(s.companies.length), "концесионери"],
            [s.withAnnual ? fmtEur(s.annual) : "няма данни", "годишно общо"],
            [String(s.flagged), "с индикатор"],
          ] as const
        ).map(([v, label]) => (
          <div key={label} className="rounded-2xl bg-raised p-4">
            <dt className="text-[13px] text-stone">{label}</dt>
            <dd className="mt-1 font-display text-xl font-bold">{v}</dd>
          </div>
        ))}
      </dl>

      {s.kinds.length > 0 && (
        <ul className="mt-5 flex flex-wrap gap-2" aria-label="По вид обект">
          {s.kinds.map(([kind, c]) => (
            <li key={kind}>
              <Link
                to={kindHref(kind)}
                className="inline-flex gap-1.5 rounded-full border-[1.5px] border-limestone bg-raised px-3 py-1 text-[13.5px] font-semibold text-ink no-underline hover:border-ink"
              >
                {KIND_LABELS[kind] ?? kind}
                <span className="font-medium text-stone">{c}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {m.settlements.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-lg font-bold">
            Населени места в концесиите
          </h2>
          <p className="mt-1 max-w-[72ch] text-ink/90">
            {m.settlements.join(", ")}
          </p>
        </section>
      )}

      {s.companies.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-lg font-bold">
            Концесионери в община {m.name}
          </h2>
          <ul className="mt-2 grid gap-x-8 sm:grid-cols-2">
            {s.companies.slice(0, 12).map((c) => (
              <li
                key={c.eik ?? c.name}
                className="flex justify-between gap-4 border-b border-limestone py-2"
              >
                {c.eik ? (
                  <Link
                    to={companyHref(c.name, c.eik)}
                    className="font-semibold text-ink hover:text-water"
                  >
                    {c.name}
                  </Link>
                ) : (
                  <span className="font-semibold">{c.name}</span>
                )}
                <span className="text-stone tabular-nums">{c.n}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <h2 className="font-display text-lg font-bold">
          Всички концесии в община {m.name}
        </h2>
        <ConcessionsTable rows={concessions} />
      </section>

      {neighbours.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-lg font-bold">
            Други общини в област {m.oblast}
          </h2>
          <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5">
            {neighbours.map((x) => (
              <li key={x.slug}>
                <Link
                  to={municipalityHref(x.slug)}
                  className="text-water underline underline-offset-2"
                >
                  {x.name}
                </Link>{" "}
                <span className="text-[13px] text-stone">{x.concessions}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-10 max-w-[72ch] border-t border-limestone pt-4 text-[13px] text-stone">
        Регистрите нямат поле „община". Тя е определена по обекта в обявлението
        ({m.sources.object}), по концедента, когато това е общината (
        {m.sources.grantor}), или по „община …" в предмета на концесията (
        {m.sources.text}). Имената на общините са сверени с{" "}
        <a href="https://www.geonames.org" rel="noopener" className="underline">
          GeoNames
        </a>{" "}
        (CC BY 4.0). <Link to={PATHS.methodology}>Методология</Link>.
      </p>
    </>
  );
}
