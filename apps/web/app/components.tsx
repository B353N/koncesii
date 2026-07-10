import type { ReactNode } from "react";
import { Link } from "react-router";
import {
  FLAG_DESCRIPTIONS,
  fmtEur,
  fmtMonths,
  SEVERITY_LABELS,
} from "./format";
import type { ConcessionRow } from "./queries.server";

/** Речникът на интерфейса — docs/design.md. */

const HATCH: Record<string, string> = {
  high: "hatch-high border-oxide/50",
  medium: "hatch-med border-ochre/50",
  low: "hatch-low border-stone/50",
};
const FLAG_TEXT: Record<string, string> = {
  high: "text-oxide border-oxide/45",
  medium: "text-ochre border-ochre/45",
  low: "text-stone border-stone/45",
};

export function FlagMark({
  severity,
  code,
}: {
  severity: string;
  code?: string;
}) {
  return (
    <span
      title={
        code
          ? `${code} — ${SEVERITY_LABELS[severity] ?? severity} тежест`
          : undefined
      }
      className={`inline-block h-3.5 w-3.5 rounded-[1px] border align-[-2px] ${HATCH[severity] ?? HATCH["low"]}`}
    />
  );
}

export function FlagBadge({
  code,
  severity,
  detail,
}: {
  code: string;
  severity: string;
  detail?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[2px] border px-2 py-0.5 font-mono text-[12.5px] ${FLAG_TEXT[severity] ?? FLAG_TEXT["low"]}`}
      title={FLAG_DESCRIPTIONS[code]}
    >
      <span
        className={`h-3.5 w-3.5 rounded-[1px] border ${HATCH[severity] ?? HATCH["low"]}`}
      />
      {code}
      {detail ? ` · ${detail}` : ""}
    </span>
  );
}

/** Произход-чип: всяко показано число е проследимо до източника. */
export function Prov({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  const external = href.startsWith("http");
  return (
    <a
      href={href}
      className="inline-flex items-center gap-1.5 rounded-[2px] border border-limestone bg-raised px-2 py-0.5 text-[12.5px] text-water no-underline hover:border-water"
      {...(external ? { rel: "noopener" } : {})}
    >
      {children}
      {external && <span className="text-[11px]">↗</span>}
    </a>
  );
}

export function FlagMarks({ flags }: { flags: string | null }) {
  if (!flags) return null;
  return (
    <span className="whitespace-nowrap">
      {flags.split(",").map((s, i) => (
        <span key={i} className="mr-0.5">
          <FlagMark severity={s} />
        </span>
      ))}
    </span>
  );
}

export function PageTitle({
  title,
  count,
}: {
  title: string;
  count?: ReactNode;
}) {
  return (
    <div className="pt-8">
      <h1 className="font-display text-3xl font-bold">{title}</h1>
      {count && <p className="mt-0.5 text-sm text-stone">{count}</p>}
    </div>
  );
}

/** Празно състояние: базата още не е публикувана. Сайтът не гърми. */
export function DataPending() {
  return (
    <div className="my-16 border border-dashed border-stone px-6 py-10 text-center">
      <h1 className="font-display text-2xl font-bold">Данните се подготвят</h1>
      <p className="mx-auto mt-3 max-w-lg text-stone">
        Първото пълно извличане от Националния концесионен регистър още не е
        публикувано. Методологията и кодът вече са отворени:{" "}
        <a
          className="text-water underline underline-offset-2"
          href="https://github.com/B353N/koncesii"
        >
          github.com/B353N/koncesii
        </a>
        .
      </p>
    </div>
  );
}

export function ConcessionsTable({
  rows,
  showGrantor = true,
}: {
  rows: ConcessionRow[];
  showGrantor?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="my-2 w-full border-collapse text-[13.5px]">
        <thead>
          <tr className="border-b-[1.5px] border-ink text-left font-mono text-[11.5px] uppercase tracking-wider text-stone">
            <th scope="col" className="py-2 pr-2 font-medium">
              Обект
            </th>
            {showGrantor && (
              <th scope="col" className="py-2 pr-2 font-medium">
                Концедент
              </th>
            )}
            <th scope="col" className="py-2 pr-2 font-medium">
              Концесионер
            </th>
            <th scope="col" className="py-2 pr-2 text-right font-medium">
              Срок
            </th>
            <th scope="col" className="py-2 pr-2 text-right font-medium">
              Годишно
            </th>
            <th scope="col" className="py-2 font-medium">
              Инд.
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.reg_num} className="border-b border-limestone align-top">
              <td className="py-2 pr-2">
                <Link
                  to={`/concessions/${encodeURIComponent(r.reg_num)}`}
                  className="text-water underline decoration-1 underline-offset-2"
                >
                  {r.title}
                </Link>
                <span className="block font-mono text-xs text-stone">
                  {r.reg_num}
                </span>
              </td>
              {showGrantor && (
                <td className="py-2 pr-2">
                  {r.grantor_slug ? (
                    <Link
                      to={`/grantors/${encodeURIComponent(r.grantor_slug)}`}
                      className="text-ink hover:text-water"
                    >
                      {r.grantor_name}
                    </Link>
                  ) : (
                    (r.grantor_name ?? "—")
                  )}
                </td>
              )}
              <td className="py-2 pr-2">
                {r.eik ? (
                  <Link
                    to={`/companies/${r.eik}`}
                    className="text-ink hover:text-water"
                  >
                    {r.concessionaire_name}
                  </Link>
                ) : (
                  (r.concessionaire_name ?? "—")
                )}
                {r.eik && (
                  <span className="block font-mono text-xs text-stone">
                    ЕИК {r.eik}
                  </span>
                )}
              </td>
              <td className="py-2 pr-2 text-right font-mono tabular-nums whitespace-nowrap">
                {fmtMonths(r.term_months)}
              </td>
              <td className="py-2 pr-2 text-right font-mono tabular-nums whitespace-nowrap">
                {r.annual_payment_raw ?? fmtEur(r.annual_payment_eur)}
              </td>
              <td className="py-2">
                <FlagMarks flags={r.flags} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ExportLinks({
  csvHref,
  jsonHref,
}: {
  csvHref: string;
  jsonHref?: string;
}) {
  return (
    <div className="my-3 flex items-center gap-3 text-[13px] text-stone">
      <span>експорт:</span>
      <Prov href={csvHref}>CSV</Prov>
      {jsonHref && <Prov href={jsonHref}>JSON</Prov>}
    </div>
  );
}
