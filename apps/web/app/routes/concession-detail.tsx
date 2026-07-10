import { Link } from "react-router";
import type { Route } from "./+types/concession-detail";
import { FlagBadge, Prov } from "../components";
import {
  CONCESSION_KIND_LABELS,
  FLAG_DESCRIPTIONS,
  fmtEur,
  fmtMonths,
  fmtPercent,
  KIND_LABELS,
} from "../format";
import { getConcession } from "../queries.server";

export function meta({ loaderData }: Route.MetaArgs) {
  const title =
    loaderData && "detail" in loaderData
      ? `${loaderData.detail.concession.title} — КОНЦЕСИИ`
      : "Концесия — КОНЦЕСИИ";
  return [{ title }];
}

export function loader({ params }: Route.LoaderArgs) {
  const detail = getConcession(params.regNum);
  if (!detail) throw new Response("Not Found", { status: 404 });

  return { detail };
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

export default function ConcessionDetail({ loaderData }: Route.ComponentProps) {
  const { detail } = loaderData;
  const c = detail.concession;
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
      {/* Паспортът на партидата */}
      <div className="mt-7 mb-6 grid grid-cols-[auto_1fr] border-[1.5px] border-ink bg-raised md:grid-cols-[auto_1fr_auto]">
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
            className={`font-display font-bold leading-tight text-balance ${
              c.title.length > 140 ? "text-lg" : "text-2xl"
            }`}
          >
            {c.title}
          </h1>
          <div className="mt-2.5 text-sm text-ink/85">
            Концедент:{" "}
            {detail.grantor ? (
              <Link
                to={`/grantors/${encodeURIComponent(detail.grantor.id.slice(3))}`}
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
                    to={`/companies/${detail.concessionaire.eik}`}
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
                      Индикаторът е аритметичен факт, не твърдение за нарушение.{" "}
                      <Link
                        to="/methodology"
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

      <Razdel num="XI" title="Документи по партидата">
        {detail.documents.length > 0 ? (
          <ul className="pb-2 text-[13.5px]">
            {detail.documents.map((d, i) => (
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
              </li>
            ))}
          </ul>
        ) : (
          <p className="pb-2 text-stone">Няма приложени документи.</p>
        )}
      </Razdel>

      {/* Произход: всяко число на страницата е проследимо */}
      <div className="mt-6 flex flex-wrap items-center gap-2.5 border-t-[1.5px] border-ink pt-3.5 pb-8 text-[13px] text-stone">
        <span>Всяко число на тази страница е проследимо:</span>
        <Prov href={c.source_url}>
          {c.source === "egov" ? "data.egov.bg ресурс" : "НКР партида"}
        </Prov>
        {c["announcement_url"] != null && (
          <Prov href={c.announcement_url}>Обявление</Prov>
        )}
        <Prov href={`/concessions/${encodeURIComponent(c.reg_num)}/json`}>
          JSON изглед
        </Prov>
        <span className="ml-auto">снето на {c.fetched_at}</span>
      </div>
    </>
  );
}
