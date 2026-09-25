import type { ReactNode } from "react";
import { Link, redirect } from "react-router";
import type { Route } from "./+types/concession-detail";
import {
  Breadcrumbs,
  FlagBadge,
  Prov,
  RelatedList,
  regNumLabel,
  type Crumb,
} from "../components";
import { kindHref } from "../concessions-list";
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
  fmtMonths,
  fmtPercent,
  KIND_LABELS,
} from "../format";
import {
  concessionTitles,
  getConcession,
  relatedConcessions,
  resolveConcession,
  type ConcessionDetail,
} from "../queries.server";
import { concessionHref } from "../slug";
import {
  absUrl,
  clampDescription,
  pageTitle,
  regLabel,
  sentence,
} from "../seo";
import { breadcrumbJsonLd, concessionJsonLd, jsonLdScript } from "../jsonLd";
import { companyHref, documentHref, grantorHref, PATHS } from "../paths";

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

  return { detail, titles, related: relatedConcessions(hit.reg_num) };
}

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
  if (raw == null) return null;
  if (raw.length <= 90) {
    return (
      <span className="block max-w-[52ch] text-xs italic break-words text-stone">
        източник: „{raw}“ · {flag}
      </span>
    );
  }
  return (
    <details className="max-w-[52ch] text-xs text-stone">
      <summary className="cursor-pointer italic select-none marker:text-limestone">
        източник · {flag} · покажи оригиналния текст
      </summary>
      <span className="mt-1 block italic break-words">„{raw}“</span>
    </details>
  );
}

/** Стойност: парснатото число отпред, произходът — под него. */
function Value({
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
  return (
    <div className="min-w-0">
      <span className="block text-xs text-stone">{label}</span>
      <b className="block font-mono font-medium tabular-nums break-words">
        {value}
      </b>
      <SourceQuote raw={raw} flag={flag} />
    </div>
  );
}

/** Кратко парично представяне за паспорта: числото, не суровият абзац. */
function moneyShort(raw: string | null, eur: number | null): string {
  if (eur != null) return fmtEur(eur);
  if (raw && raw.length <= 18) return raw;
  return "—";
}

function Razdel({
  num,
  title,
  children,
}: {
  num: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid grid-cols-[64px_1fr] gap-4 border-t border-limestone pt-4 pb-2">
      <div>
        <span className="font-display text-xl font-bold text-water">{num}</span>
        <span className="block font-mono text-[10px] uppercase tracking-wider text-stone">
          Раздел
        </span>
      </div>
      <div>
        <h2 className="mb-2.5 text-[15px] font-semibold">{title}</h2>
        {children}
      </div>
    </section>
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

/** Входните числа на формулата — четими, не суров JSON. */
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

/**
 * Въпросите, с които хората търсят една концесия, и отговорите от
 * вписаните факти. Липсващ факт дава отговор „не е вписано" - това също
 * е информация за регистъра, а не празно място за догадки.
 */
function Answers({
  detail,
  headline,
}: {
  detail: ConcessionDetail;
  headline: string;
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
  if (detail.flags.length)
    items.push([
      "Има ли индикатори за риск?",
      `Да: ${detail.flags
        .map((f) => FLAG_SHORT[f.code] ?? f.code)
        .join(", ")
        .toLowerCase()}. Индикаторът е аритметичен факт по публичната методология, не обвинение.`,
    ]);
  return (
    <section className="mt-6 border-t border-limestone pt-5">
      <h2 className="font-display text-lg font-bold">Въпроси и отговори</h2>
      <div className="mt-3 grid max-w-[72ch] gap-3.5">
        {items.map(([q, a]) => (
          <div key={q}>
            <h3 className="font-bold">{q}</h3>
            <p className="mt-0.5 text-ink/90">{a}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function ConcessionDetail({ loaderData }: Route.ComponentProps) {
  const { detail, titles, related } = loaderData;
  const c = detail.concession;
  const heading = titles.headline;
  const description = descriptionOf(detail, heading);
  const place = detail.objects.find((o) => o.municipality || o.lat != null);
  // Регистровата стойност никога не изчезва: ако заглавието на страницата
  // се различава от нея (родово или отрязано), показваме я дословно.
  const rawSubject =
    c.title.trim() && c.title.trim() !== heading ? c.title.trim() : null;
  const objectKind = detail.objects[0]?.kind ?? null;
  const crumbs: Crumb[] = [
    { label: "Начало", to: "/" },
    { label: "Концесии", to: PATHS.concessions },
    ...(objectKind
      ? [
          {
            label: KIND_LABELS[objectKind] ?? objectKind,
            to: kindHref(objectKind),
          },
        ]
      : []),
    { label: regNumLabel(c.reg_num) },
  ];
  const flagDetail = (
    code: string,
    inputs: Record<string, unknown>,
  ): string => {
    if (code === "LOW_PAYMENT")
      return fmtPercent(inputs["ratio"] as number) + " годишно";
    if (code === "LONG_TERM") return fmtMonths(inputs["term_months"] as number);
    return "";
  };

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
      {/* Паспортът на партидата */}
      <div className="mt-4 mb-6 grid grid-cols-[auto_1fr] border-[1.5px] border-ink bg-raised md:grid-cols-[auto_1fr_auto]">
        <div className="flex items-center justify-center bg-water px-1.5 py-3.5 font-mono text-[13px] tracking-[0.12em] text-paper [writing-mode:vertical-rl] rotate-180">
          ПАРТИДА {c.reg_num}
        </div>
        <div className="px-5 py-4">
          <div className="mb-1 font-mono text-xs uppercase tracking-wider text-stone">
            Концесия {c.kind ? (CONCESSION_KIND_LABELS[c.kind] ?? "") : ""}
            {detail.objects[0]
              ? ` · ${(KIND_LABELS[detail.objects[0].kind] ?? "").toLowerCase()}`
              : ""}
            {c.status ? ` · ${c.status.toLowerCase()}` : ""}
          </div>
          <h1
            className={`font-sans font-bold leading-tight text-balance ${
              heading.length > 140 ? "text-xl" : "text-[26px]"
            }`}
          >
            {heading}
          </h1>
          <div className="mt-2.5 text-sm text-ink/85">
            Концедент:{" "}
            {detail.grantor ? (
              <Link
                to={grantorHref(detail.grantor.id.slice(3))}
                className="font-semibold text-water underline decoration-1 underline-offset-2"
              >
                {detail.grantor.name}
              </Link>
            ) : (
              "—"
            )}
            {" · "}Концесионер:{" "}
            {detail.concessionaire ? (
              <>
                {detail.concessionaire.eik ? (
                  <Link
                    to={companyHref(
                      detail.concessionaire.name,
                      detail.concessionaire.eik,
                    )}
                    className="font-semibold text-water underline decoration-1 underline-offset-2"
                  >
                    {detail.concessionaire.name}
                  </Link>
                ) : (
                  <b>{detail.concessionaire.name}</b>
                )}
                {detail.concessionaire.eik && (
                  <span className="font-mono text-[12.5px]">
                    {" "}
                    ЕИК {detail.concessionaire.eik}
                  </span>
                )}
              </>
            ) : (
              "—"
            )}
          </div>
        </div>
        <div className="col-span-2 flex flex-wrap gap-5 border-t border-limestone px-5 py-3.5 text-[13px] md:col-span-1 md:flex-col md:gap-2.5 md:border-t-0 md:border-l md:py-4">
          <div>
            <b className="block font-mono text-base tabular-nums">
              {fmtMonths(c.term_months)}
            </b>
            <span className="text-xs text-stone">срок</span>
          </div>
          <div>
            <b className="block font-mono text-base tabular-nums">
              {moneyShort(c.annual_payment_raw, c.annual_payment_eur)}
            </b>
            <span className="text-xs text-stone">годишно възнаграждение</span>
          </div>
          <div>
            <b className="block font-mono text-base tabular-nums">
              {moneyShort(c.value_raw, c.value_eur)}
            </b>
            <span className="text-xs text-stone">стойност на концесията</span>
          </div>
        </div>
      </div>

      {/* Накратко: същите факти в едно изречение, за читател и за търсачка */}
      <section className="mb-6">
        <h2 className="font-display text-base font-bold">Накратко</h2>
        <p className="mt-1 max-w-[72ch] text-[15px] leading-relaxed text-ink/90">
          {description}
        </p>
        {rawSubject && (
          <p className="mt-2 max-w-[72ch] text-[13.5px] text-stone">
            <span className="font-mono text-[11.5px] uppercase tracking-wider">
              Предмет по регистъра:
            </span>{" "}
            <span className="italic">„{rawSubject}“</span>
          </p>
        )}
      </section>

      {/* Индикатори с формулата и входните числа */}
      {detail.flags.length > 0 && (
        <div className="mb-6 overflow-hidden rounded-[3px] border border-oxide/40">
          <div className="hatch-high border-b border-oxide/25 bg-[#fdf6f4] px-4 py-2.5 font-mono text-xs uppercase tracking-wider text-oxide">
            Индикатори за риск · {detail.flags.length} · по публичната
            методология
          </div>
          <div className="grid gap-3 bg-raised px-4 py-3.5">
            {detail.flags.map((f) => {
              const inputs = JSON.parse(f.inputs) as Record<string, unknown>;
              return (
                <div
                  key={f.code}
                  className="grid gap-1.5 text-sm sm:grid-cols-[170px_1fr] sm:gap-3.5"
                >
                  <div>
                    <FlagBadge code={f.code} severity={f.severity} />
                  </div>
                  <div>
                    <p>
                      {FLAG_DESCRIPTIONS[f.code] ?? f.code}
                      {flagDetail(f.code, inputs)
                        ? `: ${flagDetail(f.code, inputs)}`
                        : ""}
                      .
                    </p>
                    <code className="mt-1 block max-w-full rounded-[2px] border border-limestone bg-[#f4f5f0] px-2.5 py-1 font-mono text-[12.5px] break-words tabular-nums text-ink/85">
                      {fmtInputs(inputs)}
                    </code>
                    <p className="mt-1 text-[13px] text-stone">
                      Условие по методологията:{" "}
                      {FLAG_CONDITIONS[f.code] ?? "виж методологията"}.
                      Индикаторът е аритметичен факт, не твърдение за нарушение.{" "}
                      <Link
                        to={PATHS.methodology}
                        className="text-water underline underline-offset-2"
                      >
                        Методология →
                      </Link>
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Razdel num="I–II" title="Страни">
        <div className="grid gap-2.5 pb-2 sm:grid-cols-2">
          <Value label="Концедент" value={detail.grantor?.name ?? "—"} />
          <Value
            label="Концесионер"
            value={detail.concessionaire?.name ?? "—"}
          />
          {detail.concessionaire?.eik && (
            <Value label="ЕИК" value={detail.concessionaire.eik} />
          )}
        </div>
      </Razdel>

      <Razdel num="IV" title="Обект на концесията">
        <div className="grid gap-2.5 pb-2 sm:grid-cols-2">
          {detail.objects.map((o) => (
            <div key={o.id}>
              <span className="block text-xs text-stone">
                {KIND_LABELS[o.kind] ?? o.kind}
              </span>
              <b className="block max-w-[60ch] font-medium break-words">
                {o.description}
              </b>
            </div>
          ))}
          {detail.objects.length === 0 && (
            <p className="text-stone">Няма данни за обекта.</p>
          )}
        </div>
      </Razdel>

      <Razdel num="IX" title="Финансови условия">
        <div className="grid gap-2.5 pb-2 sm:grid-cols-2">
          <Value
            label="Стойност на концесията"
            value={c.value_eur != null ? fmtEur(c.value_eur) : "—"}
            raw={c.value_raw}
            flag={c.value_flag}
          />
          <Value
            label="Годишно възнаграждение"
            value={
              c.annual_payment_eur != null ? fmtEur(c.annual_payment_eur) : "—"
            }
            raw={c.annual_payment_raw}
            flag={c.annual_payment_flag}
          />
          <Value
            label="Еднократно възнаграждение"
            value={
              c.onetime_payment_eur != null
                ? fmtEur(c.onetime_payment_eur)
                : "—"
            }
            raw={c.onetime_payment_raw}
            flag={c.onetime_payment_flag}
          />
          <Value
            label="Срок"
            value={fmtMonths(c.term_months)}
            raw={c.term_raw}
            flag={c.term_flag}
          />
        </div>
        <p className="max-w-[70ch] pb-2 text-[13px] text-stone">
          Как е изчислено: сумите във формулярите на НКР са в евро, макар да са
          отбелязани „лв.“ — регистърът ги е превалутирал при въвеждането на
          еврото, без да смени етикета. Сумите в лева от договорите и общинските
          регистри се превалутират по фиксирания курс{" "}
          {BGN_EUR_RATE.toLocaleString("bg-BG", {
            minimumFractionDigits: 5,
          })}{" "}
          лв. за 1 €. Оригиналният запис от регистъра стои до всяка стойност,
          заедно с флага за качеството му; при противоречие между източниците
          стойността се отбелязва, а не се поправя.
        </p>
        {detail.payments.length > 0 && (
          <div className="pb-2 text-[13px] text-stone">
            Записани плащания от допълващи източници:{" "}
            {detail.payments.map((p, i) => (
              <span key={i}>
                {i > 0 && ", "}
                <span className="font-mono">{p.contracted_raw}</span> (
                <a
                  href={p.source_url}
                  rel="noopener"
                  className="text-water underline underline-offset-2"
                >
                  източник ↗
                </a>
                )
              </span>
            ))}
          </div>
        )}
      </Razdel>

      {detail.facts.length > 0 && (
        <Razdel num="IX·Д" title="Извлечено от документите">
          <p className="max-w-[70ch] pb-2 text-[13px] text-stone">
            Регистърът често казва „Няма въведени данни“, а стойностите са в
            прикачените договори. Тук са клаузите, намерени в текста им по
            публично описани правила — с дословния цитат, страницата и линк към
            оригинала. Документът само попълва липсващо поле; при разминаване
            стойността от регистъра остава и полето се отбелязва.{" "}
            <Link
              to={`${PATHS.methodology}#izvlichane-ot-dokumentite`}
              className="text-water underline underline-offset-2"
            >
              Как се извлича →
            </Link>
          </p>
          <ul className="grid gap-3 pb-2">
            {detail.facts.map((f, i) => (
              <li
                key={i}
                className="border-l-2 border-limestone pl-3 text-[13.5px]"
              >
                <span className="block text-xs text-stone">
                  {FACT_LABELS[f.field] ?? f.field} ·{" "}
                  {FACT_OUTCOMES[f.outcome] ?? f.outcome}
                </span>
                <b className="font-mono font-medium tabular-nums">
                  {fmtFact(f)}
                </b>
                <span className="mt-0.5 block max-w-[72ch] italic break-words text-ink/80">
                  „{f.quote}“
                </span>
                <span className="mt-0.5 block text-xs text-stone">
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
                    оригинал ↗
                  </a>
                </span>
              </li>
            ))}
          </ul>
        </Razdel>
      )}

      <Razdel num="XI" title="Документи по партидата">
        {detail.documents.length > 0 ? (
          <ul className="pb-2 text-[13.5px]">
            {detail.documents.map((d, i) => {
              const meta = fmtDocumentMeta(d);
              return (
                <li
                  key={i}
                  className="border-t border-dashed border-limestone py-2 first:border-t-0"
                >
                  <a
                    href={d.url}
                    rel="noopener"
                    className="text-water underline decoration-1 underline-offset-2"
                  >
                    {d.title ??
                      (d.kind === "announcement"
                        ? "Обявление"
                        : `Документ ${i + 1}`)}{" "}
                    ↗
                  </a>
                  {(meta || d.text_status === "ok") && (
                    <span className="mt-0.5 block text-xs text-stone">
                      {meta}
                      {d.text_status === "ok" && (
                        <>
                          {meta ? " · " : ""}
                          <Link
                            to={documentHref(detail.slug, d.key)}
                            className="text-water underline underline-offset-2"
                          >
                            Текстът на документа →
                          </Link>
                        </>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="pb-2 text-stone">Няма приложени документи.</p>
        )}
      </Razdel>

      <Answers detail={detail} headline={heading} />

      {(related.byGrantor.length > 0 || related.byKind.length > 0) && (
        <section className="mt-6 grid gap-8 border-t border-limestone pt-5 md:grid-cols-2">
          {detail.grantor && (
            <RelatedList
              title={`Други концесии на ${detail.grantor.name}`}
              rows={related.byGrantor}
              more={{
                label: "Всички партиди на този концедент →",
                to: grantorHref(detail.grantor.id.slice(3)),
              }}
            />
          )}
          {objectKind && (
            <RelatedList
              title={`Други концесии от същия вид: ${(
                KIND_LABELS[objectKind] ?? objectKind
              ).toLowerCase()}`}
              rows={related.byKind}
              more={{
                label: `Всички ${(KIND_LABELS[objectKind] ?? objectKind).toLowerCase()} концесии →`,
                to: kindHref(objectKind),
              }}
            />
          )}
        </section>
      )}

      {/* Произход: всяко число на страницата е проследимо */}
      <div className="mt-6 flex flex-wrap items-center gap-2.5 border-t-[1.5px] border-ink pt-3.5 pb-8 text-[13px] text-stone">
        <span>Всяко число на тази страница е проследимо:</span>
        <Prov href={c.source_url}>
          {c.source === "egov" ? "data.egov.bg ресурс" : "НКР партида"}
        </Prov>
        {c["announcement_url"] != null && (
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
