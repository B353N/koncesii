import type { ReactNode } from "react";
import { Link, redirect } from "react-router";
import type { Route } from "./+types/concession-detail";
import { Breadcrumbs, Prov, type Crumb } from "../components";
import {
  BGN_EUR_RATE,
  CONCESSION_KIND_LABELS,
  FACT_LABELS,
  FACT_OUTCOMES,
  FLAG_CONDITIONS,
  FLAG_DESCRIPTIONS,
  FLAG_SHORT,
  fmtDocumentMeta,
  fmtEur,
  fmtFact,
  FULFILLMENT_LABELS,
  fmtMonths,
  fmtPercent,
  KIND_LABELS,
  SEVERITY_LABELS,
  SEVERITY_RANK,
} from "../format";
import { breadcrumbJsonLd, concessionJsonLd, jsonLdScript } from "../jsonLd";
import { FlagPin } from "../map-app";
import { DEFAULT_KIND_COLOR, KIND_COLORS } from "../map-style";
import { MiniMap } from "../mini-map";
import {
  companyHref,
  documentHref,
  grantorHref,
  kindHref,
  municipalityHref,
  PATHS,
} from "../paths";
import {
  concessionTitles,
  getConcession,
  getMunicipality,
  municipalityOf,
  relatedConcessions,
  resolveConcession,
  termBands,
  type ConcessionDetail,
  type ConcessionRow,
} from "../queries.server";
import {
  absUrl,
  clampDescription,
  pageTitle,
  regLabel,
  sentence,
} from "../seo";
import { concessionHref } from "../slug";

/**
 * Страницата на партидата: досие с графики от вписаните данни (място,
 * срок спрямо праговете, възнаграждение спрямо стойността), страните,
 * разделите на регистъра и въпросите, с които хората търсят. Нищо не се
 * измисля; всяко число води до източника си.
 */

/**
 * Описанието се сглобява от фактите в базата: вид, страни, срок,
 * възнаграждение, статус. Липсващ факт просто отпада - нищо не се
 * попълва по предположение.
 */
function descriptionOf(detail: ConcessionDetail, headline: string): string {
  const c = detail.concession;
  const who = detail.concessionaire
    ? `концесионер ${detail.concessionaire.name}${
        detail.concessionaire.eik ? ` (ЕИК ${detail.concessionaire.eik})` : ""
      }`
    : "концесионерът не е вписан";
  return clampDescription(
    sentence([
      // номерът е отпред: при еднакви факти описанието пак е уникално
      `${headline}, партида ${regLabel(c.reg_num)}:`,
      `${who}${detail.grantor ? `, концедент ${detail.grantor.name}` : ""}.`,
      c.term_months != null ? `Срок ${fmtMonths(c.term_months)}.` : null,
      c.annual_payment_eur != null
        ? `Годишно възнаграждение ${fmtEur(c.annual_payment_eur)}.`
        : null,
      c.status ? `Статус: ${c.status.toLowerCase()}.` : null,
      detail.flags.length
        ? `Индикатори: ${detail.flags
            .map((f) => FLAG_SHORT[f.code] ?? f.code)
            .join(", ")
            .toLowerCase()}.`
        : null,
      "Данни от Националния концесионен регистър.",
    ]),
  );
}

export function meta({ loaderData }: Route.MetaArgs) {
  const detail =
    loaderData && "detail" in loaderData ? loaderData.detail : null;
  if (!detail || !loaderData || !("titles" in loaderData))
    return [{ title: pageTitle("Концесия") }];
  const title = loaderData.titles.pageTitle;
  const description = descriptionOf(detail, loaderData.titles.headline);
  const url = absUrl(concessionHref(detail.slug));
  return [
    { title: pageTitle(title) },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: url },
    { property: "og:type", content: "article" },
    { tagName: "link" as const, rel: "canonical", href: url },
  ];
}

export function loader({ params }: Route.LoaderArgs) {
  const hit = resolveConcession(params.slug);
  if (!hit) throw new Response("Not Found", { status: 404 });
  // Суров номер или отрязан на "#" адрес → каноничният slug.
  if (hit.slug !== params.slug) throw redirect(concessionHref(hit.slug), 301);
  const detail = getConcession(hit.reg_num);
  const titles = concessionTitles(hit.reg_num);
  if (!detail || !titles) throw new Response("Not Found", { status: 404 });

  const municipality = municipalityOf(hit.reg_num);
  const byMunicipality = municipality
    ? (getMunicipality(municipality.slug)?.concessions ?? [])
        .filter((r) => r.reg_num !== hit.reg_num)
        .slice(0, 6)
    : [];
  const objectKind = detail.objects[0]?.kind ?? null;
  return {
    detail,
    titles,
    municipality,
    // разпределението на сроковете за същия вид - за лентата на срока
    bands: objectKind ? termBands(objectKind) : null,
    related: { ...relatedConcessions(hit.reg_num), byMunicipality },
  };
}

/** Кратко парично представяне за плочките: числото, не суровият абзац. */
function moneyShort(raw: string | null, eur: number | null): string {
  if (eur != null) return fmtEur(eur);
  if (raw && raw.length <= 18) return raw;
  return "няма данни";
}

const FLAG_LABEL: Record<string, string> = {
  ok: "от регистъра",
  parsed_from_text: "разчетено от текст",
  missing: "не е вписано",
  contradictory: "противоречиви източници",
};

/**
 * Суровият низ от формуляра никога не изчезва, но не разтяга страницата:
 * кратките цитати са видими, дългите се отварят при поискване.
 */
function SourceQuote({
  raw,
  flag,
}: {
  raw?: string | null;
  flag?: string | null;
}) {
  const flagText = flag ? (FLAG_LABEL[flag] ?? flag) : null;
  if (raw == null)
    return flagText ? (
      <span className="block text-[12px] text-stone">{flagText}</span>
    ) : null;
  if (raw.length <= 60) {
    return (
      <span className="block text-[12px] break-words text-stone">
        в регистъра: „{raw}“{flagText ? ` · ${flagText}` : ""}
      </span>
    );
  }
  return (
    <details className="text-[12px] text-stone">
      <summary className="cursor-pointer select-none marker:text-limestone">
        в регистъра{flagText ? ` · ${flagText}` : ""} · оригиналният текст
      </summary>
      <span className="mt-1 block italic break-words">„{raw}“</span>
    </details>
  );
}

const INPUT_LABELS: Record<string, string> = {
  annual_payment_eur: "годишно",
  value_eur: "стойност",
  ratio: "съотношение",
  threshold: "праг",
  term_months: "срок",
  threshold_months: "праг",
  grace_period_months: "гратисен период",
  level: "ниво",
  bidder_count: "участници",
  has_indexation: "индексация",
  annual_payment: "годишно",
  onetime_payment: "еднократно",
  fields: "полета",
};

/** Входните числа на формулата - четими, не суров JSON. */
function fmtInputs(inputs: Record<string, unknown>): string {
  return Object.entries(inputs)
    .map(([k, v]) => {
      const label = INPUT_LABELS[k] ?? k;
      let val: string;
      if (k.endsWith("_eur")) val = fmtEur(v as number);
      else if (k === "ratio" || k === "threshold")
        val = fmtPercent(v as number);
      else if (k.endsWith("_months")) val = `${v as number} мес.`;
      else if (Array.isArray(v)) val = v.join(", ");
      else val = String(v);
      return `${label} = ${val}`;
    })
    .join("  ·  ");
}

function flagDetail(code: string, inputs: Record<string, unknown>): string {
  if (code === "LOW_PAYMENT")
    return fmtPercent(inputs["ratio"] as number) + " годишно";
  if (code === "LONG_TERM") return fmtMonths(inputs["term_months"] as number);
  return "";
}

/* ---------- градивни елементи ---------- */

function Card({
  title,
  section,
  children,
  className = "",
}: {
  title?: string;
  /** номерът на раздела от формуляра на НКР - номерацията е на източника */
  section?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl bg-raised p-5 ${className}`}>
      {title && (
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="font-display text-[15px] font-bold">{title}</h2>
          {section && (
            <span className="font-mono text-[11px] tracking-wider text-stone uppercase">
              Раздел {section}
            </span>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

/** Страна по договора: инициал, име с връзка, роля. */
function PartyCard({
  role,
  name,
  to,
  sub,
}: {
  role: string;
  name: string | null;
  to?: string | null;
  sub?: string | null;
}) {
  const initial = name
    ?.replace(/^[„"«]+/u, "")
    .trim()
    .charAt(0)
    .toUpperCase();
  return (
    <div className="flex items-center gap-3 rounded-xl bg-paper p-3">
      <span
        aria-hidden="true"
        className={`flex h-10 w-10 flex-none items-center justify-center rounded-full font-display text-[15px] font-bold ${
          name
            ? "bg-ink text-white"
            : "border-2 border-dashed border-limestone text-stone"
        }`}
      >
        {initial || "?"}
      </span>
      <span className="min-w-0">
        <span className="block text-[12px] text-stone">{role}</span>
        {name ? (
          to ? (
            <Link
              to={to}
              className="block truncate font-bold text-ink no-underline hover:text-water hover:underline"
              title={name}
            >
              {name}
            </Link>
          ) : (
            <b className="block truncate" title={name}>
              {name}
            </b>
          )
        ) : (
          <span className="block font-semibold text-stone">не е вписан</span>
        )}
        {sub && (
          <span className="block font-mono text-[12px] text-stone">{sub}</span>
        )}
      </span>
    </div>
  );
}

function StatTile({
  label,
  value,
  raw,
  flag,
}: {
  label: string;
  value: string;
  raw?: string | null;
  flag?: string | null;
}) {
  const missing = value === "няма данни";
  return (
    <div className="min-w-0 rounded-2xl bg-raised p-4">
      <span className="block text-[12.5px] text-stone">{label}</span>
      <b
        className={`mt-0.5 block font-display leading-tight font-bold tracking-[-0.02em] break-words ${
          missing ? "text-[15px] text-stone" : "text-[19px] sm:text-[21px]"
        }`}
      >
        {value}
      </b>
      <div className="mt-1.5">
        <SourceQuote raw={raw} flag={flag} />
      </div>
    </div>
  );
}

const YEARS_MAX = 50;
const LONG_TERM_Y = 25;
const VERY_LONG_Y = 35;

/**
 * Срокът като лента до 50 години с праговете от методологията (25 г. за
 * индикатора LONG_TERM, 35 г. е законовият максимум). Отдолу: колко от
 * концесиите за същия вид обект са над 25 г.
 */
function TermBar({
  months,
  kindLabel,
  bands,
}: {
  months: number;
  kindLabel: string | null;
  bands: { with_term: number; over_25y: number } | null;
}) {
  const years = months / 12;
  const pct = Math.min(100, (years / YEARS_MAX) * 100);
  const long = years >= LONG_TERM_Y;
  const yr = years % 1 === 0 ? String(years) : years.toFixed(1);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="font-display text-[19px] font-bold">{yr} г.</span>
        <span className="text-[12.5px] text-stone">{months} месеца</span>
      </div>
      <div className="relative mt-2 h-3 rounded-full bg-paper">
        <div
          className={`h-3 rounded-full ${long ? "bg-sev-med" : "bg-water"}`}
          style={{ width: `${pct}%` }}
        />
        {[LONG_TERM_Y, VERY_LONG_Y].map((y) => (
          <span
            key={y}
            className="absolute top-[-3px] h-[18px] w-px bg-ink/50"
            style={{ left: `${(y / YEARS_MAX) * 100}%` }}
            aria-hidden="true"
          />
        ))}
      </div>
      <div className="relative mt-1 h-4 text-[11px] text-stone">
        <span className="absolute left-0">0</span>
        <span
          className="absolute -translate-x-1/2"
          style={{ left: `${(LONG_TERM_Y / YEARS_MAX) * 100}%` }}
        >
          25 г.
        </span>
        <span
          className="absolute -translate-x-1/2"
          style={{ left: `${(VERY_LONG_Y / YEARS_MAX) * 100}%` }}
        >
          35 г.
        </span>
        <span className="absolute right-0">50 г.</span>
      </div>
      <p className="mt-2 text-[13px] text-ink/85">
        {long
          ? `Срок от ${LONG_TERM_Y} или повече години: индикаторът „дълъг срок“ по методологията.`
          : `Под прага от ${LONG_TERM_Y} години за индикатора „дълъг срок“.`}
        {bands && bands.with_term > 0 && kindLabel
          ? ` ${bands.over_25y} от ${bands.with_term} концесии за ${kindLabel.toLowerCase()} със срок в регистъра са с 25 или повече години.`
          : ""}
      </p>
    </div>
  );
}

const RATIO_MAX = 0.03;
const RATIO_THRESHOLD = 0.01;

/**
 * Годишното възнаграждение като процент от стойността на концесията,
 * със скала до 3% и прага от 1% (индикаторът LOW_PAYMENT).
 */
function RatioGauge({ annual, value }: { annual: number; value: number }) {
  const ratio = annual / value;
  const pct = Math.min(100, (ratio / RATIO_MAX) * 100);
  const low = ratio < RATIO_THRESHOLD;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="font-display text-[19px] font-bold">
          {fmtPercent(ratio)}
        </span>
        <span className="text-[12.5px] text-stone">годишно от стойността</span>
      </div>
      <div className="relative mt-2 h-3 rounded-full bg-paper">
        <div
          className={`h-3 rounded-full ${low ? "bg-sev-high" : "bg-water"}`}
          style={{ width: `${Math.max(1.5, pct)}%` }}
        />
        <span
          className="absolute top-[-3px] h-[18px] w-px bg-ink/50"
          style={{ left: `${(RATIO_THRESHOLD / RATIO_MAX) * 100}%` }}
          aria-hidden="true"
        />
      </div>
      <div className="relative mt-1 h-4 text-[11px] text-stone">
        <span className="absolute left-0">0%</span>
        <span
          className="absolute -translate-x-1/2"
          style={{ left: `${(RATIO_THRESHOLD / RATIO_MAX) * 100}%` }}
        >
          праг 1%
        </span>
        <span className="absolute right-0">3%</span>
      </div>
      <p className="mt-2 text-[13px] text-ink/85">
        {fmtEur(annual)} годишно при стойност {fmtEur(value)}.{" "}
        {low
          ? "Под 1%: индикаторът „ниско възнаграждение“ по методологията."
          : "Над прага от 1% за индикатора „ниско възнаграждение“."}
      </p>
    </div>
  );
}

function FlagCard({
  code,
  severity,
  inputs,
}: {
  code: string;
  severity: string;
  inputs: Record<string, unknown>;
}) {
  const sev = SEVERITY_RANK[severity] ?? 1;
  const detail = flagDetail(code, inputs);
  return (
    <li className="rounded-2xl bg-raised p-4">
      <div className="flex items-start gap-3">
        <FlagPin sev={sev} />
        <div className="min-w-0 flex-1">
          <b className="block">{FLAG_SHORT[code] ?? code}</b>
          <span className="block text-[13px] text-ink/85">
            {FLAG_DESCRIPTIONS[code] ?? code}
            {detail ? `: ${detail}` : ""}.
          </span>
          <span className="mt-1 block font-mono text-[11.5px] text-stone">
            {code} · {SEVERITY_LABELS[severity] ?? severity} тежест
          </span>
          <details className="mt-2 text-[12.5px] text-stone">
            <summary className="cursor-pointer select-none marker:text-limestone">
              Формулата и входните числа
            </summary>
            <code className="mt-1.5 block rounded-lg bg-paper px-2.5 py-1.5 font-mono text-[12px] break-words tabular-nums text-ink/85">
              {fmtInputs(inputs)}
            </code>
            <p className="mt-1.5">
              Условие по методологията:{" "}
              {FLAG_CONDITIONS[code] ?? "виж методологията"}. Индикаторът е
              аритметичен факт, не твърдение за нарушение.{" "}
              <Link
                to={PATHS.methodology}
                className="text-water underline underline-offset-2"
              >
                Методология
              </Link>
            </p>
          </details>
        </div>
      </div>
    </li>
  );
}

/** Списък от свързани партиди като карти с флагче и кратко заглавие. */
function RelatedCards({
  title,
  rows,
  more,
}: {
  title: string;
  rows: ConcessionRow[];
  more: { label: string; to: string };
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h3 className="font-display text-[15px] font-bold">{title}</h3>
      <ul className="mt-2 grid gap-1.5">
        {rows.map((r) => {
          const sev = Math.max(
            0,
            ...(r.flags ?? "").split(",").map((s) => SEVERITY_RANK[s] ?? 0),
          );
          return (
            <li
              key={r.reg_num}
              className="flex gap-2.5 rounded-xl bg-raised px-3 py-2.5"
            >
              <FlagPin sev={sev} kind={r.object_kind ?? undefined} />
              <span className="min-w-0">
                <Link
                  to={concessionHref(r.slug)}
                  className="line-clamp-2 text-[14px] font-semibold text-ink no-underline hover:text-water hover:underline"
                  title={r.title}
                >
                  {r.headline}
                </Link>
                <span className="block text-[12.5px] text-stone">
                  {r.concessionaire_name ?? "концесионерът не е вписан"}
                  {r.annual_payment_eur != null
                    ? `, ${fmtEur(r.annual_payment_eur)} годишно`
                    : ""}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      <Link
        to={more.to}
        className="mt-2 inline-block text-[13.5px] font-semibold text-water"
      >
        {more.label}
      </Link>
    </div>
  );
}

/**
 * Въпросите, с които хората търсят една концесия, и отговорите от
 * вписаните факти. Липсващ факт дава отговор „не е вписано" - това също
 * е информация за регистъра, а не празно място за догадки.
 */
function Answers({
  detail,
  headline,
  municipality,
}: {
  detail: ConcessionDetail;
  headline: string;
  municipality: { slug: string; name: string; oblast: string } | null;
}) {
  const c = detail.concession;
  const who = detail.concessionaire;
  const items: Array<[string, ReactNode]> = [
    [
      `Кой е концесионерът на ${headline}?`,
      who ? (
        <>
          {who.eik ? (
            <Link
              to={companyHref(who.name, who.eik)}
              className="font-semibold text-water underline underline-offset-2"
            >
              {who.name}
            </Link>
          ) : (
            <b>{who.name}</b>
          )}
          {who.eik ? `, ЕИК ${who.eik}` : ""}.
        </>
      ) : (
        "В регистъра не е вписан концесионер."
      ),
    ],
    [
      "Кой е отдал концесията?",
      detail.grantor ? (
        <>
          Концедент е{" "}
          <Link
            to={grantorHref(detail.grantor.id.slice(3))}
            className="font-semibold text-water underline underline-offset-2"
          >
            {detail.grantor.name}
          </Link>
          .
        </>
      ) : (
        "Концедентът не е вписан."
      ),
    ],
    [
      "За колко години е концесията?",
      c.term_months != null
        ? `Срокът е ${fmtMonths(c.term_months)}${c.status ? `; статус в регистъра: ${c.status.toLowerCase()}` : ""}.`
        : "Срокът не е вписан в регистъра.",
    ],
    [
      "Колко плаща концесионерът?",
      c.annual_payment_eur != null || c.onetime_payment_eur != null
        ? [
            c.annual_payment_eur != null
              ? `Годишното възнаграждение е ${fmtEur(c.annual_payment_eur)}`
              : null,
            c.onetime_payment_eur != null
              ? `еднократното е ${fmtEur(c.onetime_payment_eur)}`
              : null,
          ]
            .filter(Boolean)
            .join(", ") + ", по данните в регистъра."
        : "В регистъра не е вписано възнаграждение.",
    ],
  ];
  if (municipality)
    items.splice(1, 0, [
      "В коя община е обектът?",
      <>
        В община{" "}
        <Link
          to={municipalityHref(municipality.slug)}
          className="font-semibold text-water underline underline-offset-2"
        >
          {municipality.name}
        </Link>
        , област {municipality.oblast}.
      </>,
    ]);
  if (detail.flags.length)
    items.push([
      "Има ли индикатори за риск?",
      `Да: ${detail.flags
        .map((f) => FLAG_SHORT[f.code] ?? f.code)
        .join(", ")
        .toLowerCase()}. Индикаторът е аритметичен факт по публичната методология, не обвинение.`,
    ]);
  return (
    <Card title="Въпроси и отговори" className="mt-4">
      <div className="grid max-w-[72ch] gap-3.5">
        {items.map(([q, a]) => (
          <div key={q}>
            <h3 className="font-bold">{q}</h3>
            <p className="mt-0.5 text-[14.5px] text-ink/90">{a}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ---------- страницата ---------- */

export default function ConcessionDetail({ loaderData }: Route.ComponentProps) {
  const { detail, titles, related, municipality, bands } = loaderData;
  const c = detail.concession;
  const heading = titles.headline;
  const description = descriptionOf(detail, heading);
  // Регистровата стойност никога не изчезва: ако заглавието на страницата
  // се различава от нея (кратко или родово), показваме я дословно.
  const rawSubject =
    c.title.trim() && c.title.trim() !== heading ? c.title.trim() : null;
  const object = detail.objects[0] ?? null;
  const objectKind = object?.kind ?? null;
  const kindLabel = objectKind ? (KIND_LABELS[objectKind] ?? objectKind) : null;
  const place = detail.objects.find((o) => o.municipality || o.lat != null);
  const geo = detail.objects.find((o) => o.lat != null && o.lon != null);
  const sev = Math.max(
    0,
    ...detail.flags.map((f) => SEVERITY_RANK[f.severity] ?? 0),
  );
  const crumbs: Crumb[] = [
    { label: "Начало", to: "/" },
    { label: "Концесии", to: PATHS.concessions },
    ...(objectKind ? [{ label: kindLabel!, to: kindHref(objectKind) }] : []),
    { label: regLabel(c.reg_num) },
  ];
  const hasRatio =
    c.annual_payment_eur != null && c.value_eur != null && c.value_eur > 0;
  const hasTerm = c.term_months != null && c.term_months > 0;
  const kindColor = KIND_COLORS[objectKind ?? ""] ?? DEFAULT_KIND_COLOR;

  return (
    <>
      <Breadcrumbs items={crumbs} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript([
          breadcrumbJsonLd(crumbs),
          concessionJsonLd({
            url: absUrl(concessionHref(detail.slug)),
            name: titles.pageTitle,
            description,
            regNum: c.reg_num,
            place: place
              ? {
                  name: place.place ?? place.municipality ?? null,
                  municipality: place.municipality,
                  oblast: place.oblast,
                  lat: place.lat,
                  lon: place.lon,
                }
              : null,
            sourceUrl: c.source_url,
            fetchedAt: c.fetched_at,
            grantorName: detail.grantor?.name ?? null,
            grantorUrl: detail.grantor
              ? absUrl(grantorHref(detail.grantor.id.slice(3)))
              : null,
            concessionaireName: detail.concessionaire?.name ?? null,
            concessionaireEik: detail.concessionaire?.eik ?? null,
            concessionaireUrl: detail.concessionaire?.eik
              ? absUrl(
                  companyHref(
                    detail.concessionaire.name,
                    detail.concessionaire.eik,
                  ),
                )
              : null,
          }),
        ])}
      />

      {/* Досието: вид, статус, заглавие, страни */}
      <header className="mt-4 rounded-2xl bg-raised p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          {objectKind && (
            <Link
              to={kindHref(objectKind)}
              className="inline-flex items-center gap-1.5 rounded-full border-[1.5px] border-limestone px-2.5 py-0.5 font-semibold text-ink no-underline hover:border-ink"
            >
              <i
                className="inline-block h-[9px] w-[9px] rounded-full"
                style={{ background: kindColor }}
              />
              {kindLabel}
            </Link>
          )}
          {c.kind && CONCESSION_KIND_LABELS[c.kind] && (
            <span className="rounded-full bg-paper px-2.5 py-0.5 font-semibold">
              концесия {CONCESSION_KIND_LABELS[c.kind]}
            </span>
          )}
          {c.status && (
            <span className="rounded-full bg-paper px-2.5 py-0.5 font-semibold">
              {c.status.toLowerCase()}
            </span>
          )}
          <span className="font-mono text-[12.5px] text-stone">
            партида {c.reg_num}
          </span>
        </div>
        <h1
          className={`mt-3 font-display leading-[1.15] font-bold tracking-[-0.02em] text-balance ${
            heading.length > 90
              ? "text-[21px] sm:text-[24px]"
              : "text-[26px] sm:text-[30px]"
          }`}
        >
          {heading}
        </h1>
        {rawSubject && (
          <p className="mt-2 max-w-[80ch] text-[13.5px] text-stone">
            По регистъра: <span className="italic">„{rawSubject}“</span>
          </p>
        )}
        <div className="mt-5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          <PartyCard
            role="Концедент"
            name={detail.grantor?.name ?? null}
            to={detail.grantor ? grantorHref(detail.grantor.id.slice(3)) : null}
          />
          <PartyCard
            role="Концесионер"
            name={detail.concessionaire?.name ?? null}
            to={
              detail.concessionaire?.eik
                ? companyHref(
                    detail.concessionaire.name,
                    detail.concessionaire.eik,
                  )
                : null
            }
            sub={
              detail.concessionaire?.eik
                ? `ЕИК ${detail.concessionaire.eik}`
                : null
            }
          />
          <PartyCard
            role="Място"
            name={
              municipality
                ? `Община ${municipality.name}`
                : place?.oblast
                  ? `Област ${place.oblast}`
                  : null
            }
            to={municipality ? municipalityHref(municipality.slug) : null}
            sub={municipality ? `област ${municipality.oblast}` : null}
          />
        </div>
      </header>

      {/* Числата */}
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Срок"
          value={
            c.term_months != null ? fmtMonths(c.term_months) : "няма данни"
          }
          raw={c.term_raw}
          flag={c.term_flag}
        />
        <StatTile
          label="Годишно възнаграждение"
          value={moneyShort(c.annual_payment_raw, c.annual_payment_eur)}
          raw={c.annual_payment_raw}
          flag={c.annual_payment_flag}
        />
        <StatTile
          label="Стойност на концесията"
          value={moneyShort(c.value_raw, c.value_eur)}
          raw={c.value_raw}
          flag={c.value_flag}
        />
        <StatTile
          label="Еднократно възнаграждение"
          value={moneyShort(c.onetime_payment_raw, c.onetime_payment_eur)}
          raw={c.onetime_payment_raw}
          flag={c.onetime_payment_flag}
        />
      </div>

      {/* Индикаторите */}
      {detail.flags.length > 0 && (
        <section className="mt-6">
          <h2 className="font-display text-lg font-bold">
            {detail.flags.length === 1
              ? "1 индикатор за риск"
              : `${detail.flags.length} индикатора за риск`}
          </h2>
          <p className="mt-0.5 mb-3 text-[13.5px] text-stone">
            Аритметични факти по{" "}
            <Link to={PATHS.methodology} className="text-water underline">
              публичната методология
            </Link>
            , не обвинения.
          </p>
          <ul className="grid gap-3 md:grid-cols-2">
            {detail.flags.map((f) => (
              <FlagCard
                key={f.code}
                code={f.code}
                severity={f.severity}
                inputs={JSON.parse(f.inputs) as Record<string, unknown>}
              />
            ))}
          </ul>
        </section>
      )}

      {/* Графиките: къде е, колко дълго, срещу колко */}
      {(geo || hasTerm || hasRatio) && (
        <section className="mt-6">
          <h2 className="font-display text-lg font-bold">
            Къде е, за колко време и срещу колко
          </h2>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {geo && (
              <MiniMap
                lat={geo.lat!}
                lon={geo.lon!}
                kind={geo.kind}
                sev={sev}
                precision={geo.geo_precision}
                label={[
                  geo.place,
                  geo.municipality && `община ${geo.municipality}`,
                  geo.oblast && `област ${geo.oblast}`,
                ]
                  .filter(Boolean)
                  .join(", ")}
              />
            )}
            <div className="grid gap-3">
              {hasTerm && (
                <Card title="Срокът спрямо праговете">
                  <TermBar
                    months={c.term_months!}
                    kindLabel={kindLabel}
                    bands={bands}
                  />
                </Card>
              )}
              {hasRatio && (
                <Card title="Възнаграждението спрямо стойността">
                  <RatioGauge
                    annual={c.annual_payment_eur!}
                    value={c.value_eur!}
                  />
                </Card>
              )}
              {!hasTerm && !hasRatio && geo && (
                <Card title="Срок и възнаграждение">
                  <p className="text-[14px] text-stone">
                    В регистъра не са вписани срок и стойност, по които да се
                    сравни тази концесия. Проверете документите по партидата.
                  </p>
                </Card>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Накратко: същите факти в едно изречение, за читател и за търсачка */}
      <Card title="Накратко" className="mt-6">
        <p className="max-w-[76ch] text-[15px] leading-relaxed text-ink/90">
          {description}
        </p>
      </Card>

      {/* Разделите на регистъра */}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Card title="Обект на концесията" section="IV">
          <ul className="grid gap-2.5">
            {detail.objects.map((o) => (
              <li key={o.id}>
                <span className="block text-[12.5px] text-stone">
                  {KIND_LABELS[o.kind] ?? o.kind}
                  {o.municipality ? ` · община ${o.municipality}` : ""}
                  {o.oblast ? `, област ${o.oblast}` : ""}
                </span>
                <span className="block text-[14px] break-words">
                  {o.description}
                </span>
              </li>
            ))}
            {detail.objects.length === 0 && (
              <li className="text-stone">Няма данни за обекта.</li>
            )}
          </ul>
        </Card>
        <Card title="Условия" section="IX">
          <dl className="grid gap-2.5 text-[14px]">
            {c.grace_period_months != null || c.grace_period_raw ? (
              <div>
                <dt className="text-[12.5px] text-stone">Гратисен период</dt>
                <dd className="font-semibold">
                  {c.grace_period_months != null
                    ? `${c.grace_period_months} мес.`
                    : c.grace_period_raw}
                </dd>
              </div>
            ) : null}
            <div>
              <dt className="text-[12.5px] text-stone">Индексация</dt>
              <dd className="font-semibold">
                {c.has_indexation === 1
                  ? "има клауза"
                  : c.has_indexation === 0
                    ? "няма клауза"
                    : "не е вписано"}
              </dd>
              {c.indexation_raw && <SourceQuote raw={c.indexation_raw} />}
            </div>
            {c.extensions_raw && (
              <div>
                <dt className="text-[12.5px] text-stone">Удължаване</dt>
                <dd className="text-[13.5px] break-words">
                  {c.extensions_raw}
                </dd>
              </div>
            )}
            {detail.payments.length > 0 && (
              <div>
                <dt className="text-[12.5px] text-stone">
                  Плащания от допълващи източници
                </dt>
                <dd className="text-[13.5px]">
                  {detail.payments.map((p, i) => (
                    <span key={i}>
                      {i > 0 && ", "}
                      <span className="font-mono">{p.contracted_raw}</span> (
                      <a
                        href={p.source_url}
                        rel="noopener"
                        className="text-water underline underline-offset-2"
                      >
                        източник
                      </a>
                      )
                    </span>
                  ))}
                </dd>
              </div>
            )}
          </dl>
          <details className="mt-3 text-[12.5px] text-stone">
            <summary className="cursor-pointer select-none marker:text-limestone">
              Как са изчислени сумите в евро
            </summary>
            <p className="mt-1.5 max-w-[70ch]">
              Сумите във формулярите на НКР са в евро, макар да са отбелязани
              „лв.“: регистърът ги е превалутирал при въвеждането на еврото, без
              да смени етикета. Сумите в лева от договорите и общинските
              регистри се превалутират по фиксирания курс{" "}
              {BGN_EUR_RATE.toLocaleString("bg-BG", {
                minimumFractionDigits: 5,
              })}{" "}
              лв. за 1 €. Оригиналният запис стои до всяка стойност, заедно с
              флага за качеството му; при противоречие между източниците
              стойността се отбелязва, а не се поправя.
            </p>
          </details>
        </Card>
      </div>

      {detail.facts.length > 0 && (
        <Card title="Извлечено от документите" section="IX" className="mt-3">
          <p className="mb-3 max-w-[76ch] text-[13.5px] text-stone">
            Регистърът често казва „Няма въведени данни“, а стойностите са в
            прикачените договори. Тук са клаузите, намерени в текста им по
            публично описани правила, с дословния цитат и страницата. Документът
            само попълва липсващо поле; при разминаване стойността от регистъра
            остава и полето се отбелязва.{" "}
            <Link
              to={`${PATHS.methodology}#izvlichane-ot-dokumentite`}
              className="text-water underline underline-offset-2"
            >
              Как се извлича
            </Link>
          </p>
          <ul className="grid gap-3 md:grid-cols-2">
            {detail.facts.map((f, i) => (
              <li key={i} className="rounded-xl bg-paper p-3 text-[13.5px]">
                <span className="block text-[12px] text-stone">
                  {FACT_LABELS[f.field] ?? f.field} ·{" "}
                  {FACT_OUTCOMES[f.outcome] ?? f.outcome}
                </span>
                <b className="block font-display text-[16px] font-bold">
                  {fmtFact(f)}
                </b>
                <span className="mt-1 block italic break-words text-ink/80">
                  „{f.quote}“
                </span>
                <span className="mt-1 block text-[12px] text-stone">
                  {f.document_title ?? "документ"}, стр. {f.page} ·{" "}
                  <Link
                    to={`${documentHref(detail.slug, f.document_key)}#str-${f.page}`}
                    className="text-water underline underline-offset-2"
                  >
                    текст
                  </Link>{" "}
                  ·{" "}
                  <a
                    href={f.document_url}
                    rel="noopener"
                    className="text-water underline underline-offset-2"
                  >
                    оригинал
                  </a>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {detail.reportedPayments.length > 0 && (
        <Card title="Отчети за изпълнение" section="IX" className="mt-3">
          <p className="mb-3 max-w-[76ch] text-[13.5px] text-stone">
            Всяка година концедентът подава в НКР информация за изпълнението на
            договора. Тук е т. 4.9 от тези отчети: дължимото концесионно
            възнаграждение за годината и какво е отметнато за плащането му,
            дословно. Когато отметката не се чете еднозначно (например при
            сканиран отчет), тя не се тълкува.{" "}
            <Link
              to={`${PATHS.methodology}#izvlichane-ot-dokumentite`}
              className="text-water underline underline-offset-2"
            >
              Как се извлича
            </Link>
          </p>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {detail.reportedPayments.map((r, i) => (
              <li key={i} className="rounded-xl bg-paper p-3 text-[13.5px]">
                <span className="block text-[12px] text-stone">
                  {r.year != null
                    ? `${r.year} г.`
                    : "годината не е посочена в отчета"}
                </span>
                <b className="block font-display text-[16px] font-bold">
                  {r.due_eur != null
                    ? fmtEur(r.due_eur)
                    : (r.due_raw ?? "няма данни")}
                </b>
                <span className="block text-[12px] text-stone">
                  дължимо
                  {r.due_eur != null && r.due_raw ? ` (${r.due_raw})` : ""}
                </span>
                <span className="mt-1 block">
                  {r.fulfillment
                    ? FULFILLMENT_LABELS[r.fulfillment]
                    : "плащането не е отметнато еднозначно"}
                  {r.paid_raw && (
                    <>
                      , платени <span className="font-mono">{r.paid_raw}</span>
                    </>
                  )}
                  {r.on_time != null && (
                    <>, {r.on_time ? "в срок" : "не в срок"}</>
                  )}
                </span>
                {r.arrears_raw && (
                  <span className="block text-[12.5px]">
                    От предходни години:{" "}
                    <span className="font-mono">{r.arrears_raw}</span>
                  </span>
                )}
                <details className="mt-1 text-[12px] text-stone">
                  <summary className="cursor-pointer select-none marker:text-limestone">
                    цитат от отчета, стр. {r.page}
                  </summary>
                  <span className="mt-0.5 block italic break-words text-ink/80">
                    „{r.quote}“
                  </span>
                </details>
                <span className="mt-1 block text-[12px] text-stone">
                  <Link
                    to={`${documentHref(detail.slug, r.document_key)}#str-${r.page}`}
                    className="text-water underline underline-offset-2"
                  >
                    текст
                  </Link>{" "}
                  ·{" "}
                  <a
                    href={r.document_url}
                    rel="noopener"
                    className="text-water underline underline-offset-2"
                  >
                    оригинал
                  </a>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Документи по партидата" section="XI" className="mt-3">
        {detail.documents.length > 0 ? (
          <ul className="grid gap-2 sm:grid-cols-2">
            {detail.documents.map((d, i) => {
              const meta = fmtDocumentMeta(d);
              const ext =
                /\.([a-z0-9]{2,5})$/i
                  .exec(d.file_name ?? d.url)?.[1]
                  ?.toUpperCase() ?? "DOC";
              const title =
                d.title ??
                (d.kind === "announcement" ? "Обявление" : `Документ ${i + 1}`);
              return (
                <li
                  key={i}
                  className="flex items-start gap-3 rounded-xl bg-paper p-3"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-10 w-9 flex-none items-center justify-center rounded-md border-[1.5px] border-limestone bg-raised font-mono text-[10px] font-bold text-stone"
                  >
                    {ext.slice(0, 4)}
                  </span>
                  <span className="min-w-0">
                    <a
                      href={d.url}
                      rel="noopener"
                      className="block text-[14px] font-semibold text-ink no-underline hover:text-water hover:underline"
                    >
                      {title}
                    </a>
                    <span className="block text-[12.5px] text-stone">
                      {meta || "оригинал в регистъра"}
                      {d.text_status === "ok" && (
                        <>
                          {" · "}
                          <Link
                            to={documentHref(detail.slug, d.key)}
                            className="text-water underline underline-offset-2"
                          >
                            текстът
                          </Link>
                        </>
                      )}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-stone">Няма приложени документи.</p>
        )}
      </Card>

      <Answers detail={detail} headline={heading} municipality={municipality} />

      {(related.byGrantor.length > 0 ||
        related.byKind.length > 0 ||
        related.byMunicipality.length > 0) && (
        <section className="mt-8">
          <h2 className="font-display text-lg font-bold">Свързани концесии</h2>
          <div className="mt-3 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {municipality && (
              <RelatedCards
                title={`В община ${municipality.name}`}
                rows={related.byMunicipality}
                more={{
                  label: `Всички концесии в община ${municipality.name}`,
                  to: municipalityHref(municipality.slug),
                }}
              />
            )}
            {detail.grantor && (
              <RelatedCards
                title={`От ${detail.grantor.name}`}
                rows={related.byGrantor}
                more={{
                  label: "Всички партиди на този концедент",
                  to: grantorHref(detail.grantor.id.slice(3)),
                }}
              />
            )}
            {objectKind && (
              <RelatedCards
                title={`Други: ${kindLabel!.toLowerCase()}`}
                rows={related.byKind}
                more={{
                  label: `Всички концесии за ${kindLabel!.toLowerCase()}`,
                  to: kindHref(objectKind),
                }}
              />
            )}
          </div>
        </section>
      )}

      {/* Произход: всяко число на страницата е проследимо */}
      <div className="mt-8 flex flex-wrap items-center gap-2.5 border-t-[1.5px] border-ink pt-3.5 pb-8 text-[13px] text-stone">
        <span>Всяко число на тази страница е проследимо:</span>
        <Prov href={c.source_url}>
          {c.source === "egov" ? "data.egov.bg ресурс" : "НКР партида"}
        </Prov>
        {c.announcement_url != null && (
          <Prov href={c.announcement_url}>Обявление</Prov>
        )}
        <Prov href={`${concessionHref(detail.slug)}/json`} nofollow>
          JSON изглед
        </Prov>
        <span className="ml-auto">снето на {c.fetched_at}</span>
      </div>
    </>
  );
}
