import type { ReactNode } from "react";
import { Link } from "react-router";
import {
  FLAG_DESCRIPTIONS,
  fmtEur,
  fmtMonths,
  SEVERITY_LABELS,
} from "./format";
import type { ConcessionRow } from "./queries.server";
import { concessionHref } from "./slug";
import { companyHref, grantorHref } from "./paths";

/** Речникът на интерфейса — docs/design.md. */

/** Синтетичен номер от общински ресурс (uuid#ред) не се показва суров. */
const SYNTHETIC_REG_RE = /^[0-9a-f-]{30,}#\d+$/i;

export function regNumLabel(regNum: string): string {
  return SYNTHETIC_REG_RE.test(regNum) ? "общински регистър" : regNum;
}

/** Кратко представяне на годишното: суровото, ако е кратко; иначе EUR. */
export function annualLabel(
  raw: string | null,
  eur: number | null,
): { text: string; full: string | null; wrap: boolean } {
  if (raw && raw.length <= 24) return { text: raw, full: null, wrap: false };
  if (eur != null) return { text: fmtEur(eur), full: raw, wrap: false };
  if (raw) return { text: raw.slice(0, 24) + "…", full: raw, wrap: false };
  return { text: "—", full: null, wrap: false };
}

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
  nofollow = false,
}: {
  href: string;
  children: ReactNode;
  /** Машинни изгледи (CSV, JSON) не се подават на търсачките - пестят crawl budget. */
  nofollow?: boolean;
}) {
  const external = href.startsWith("http");
  const rel = [external && "noopener", nofollow && "nofollow"]
    .filter(Boolean)
    .join(" ");
  return (
    <a
      href={href}
      className="inline-flex items-center gap-1.5 rounded-[2px] border border-limestone bg-raised px-2 py-0.5 text-[12.5px] text-water no-underline hover:border-water"
      {...(rel ? { rel } : {})}
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

export interface Crumb {
  label: string;
  /** Последната троха е текущата страница и няма линк. */
  to?: string;
}

/**
 * Пътека до страницата: дава на читателя и на търсачките структурата
 * Начало > Концесии > Вид > Партида. Schema.org разметката се добавя
 * отделно като JSON-LD (jsonLd.ts).
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Пътека" className="pt-6 text-[13px] text-stone">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        {items.map((c, i) => (
          <li key={i} className="flex items-center gap-1.5">
            {i > 0 && (
              <span aria-hidden="true" className="text-limestone">
                ›
              </span>
            )}
            {c.to ? (
              <Link to={c.to} className="text-water hover:underline">
                {c.label}
              </Link>
            ) : (
              <span className="text-ink/70">{c.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Кратък списък от свързани партиди (същия концедент / същия вид). */
export function RelatedList({
  title,
  rows,
  more,
}: {
  title: string;
  rows: ConcessionRow[];
  more?: { label: string; to: string };
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h2 className="font-display text-base font-bold">{title}</h2>
      <ul className="mt-1.5 text-[13.5px]">
        {rows.map((r) => (
          <li key={r.reg_num} className="border-t border-limestone py-1.5">
            <Link
              to={concessionHref(r.slug)}
              className="line-clamp-2 text-water underline decoration-1 underline-offset-2"
              title={r.title}
            >
              {r.title}
            </Link>
            <span className="block font-mono text-xs text-stone">
              {regNumLabel(r.reg_num)}
              {r.annual_payment_eur != null && (
                <> · {fmtEur(r.annual_payment_eur)} годишно</>
              )}
            </span>
          </li>
        ))}
      </ul>
      {more && (
        <Link
          to={more.to}
          className="mt-1.5 inline-block text-[13px] text-water underline underline-offset-2"
        >
          {more.label}
        </Link>
      )}
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
      <table className="my-2 w-full min-w-[760px] table-fixed border-collapse text-[13.5px]">
        <thead>
          <tr className="border-b-[1.5px] border-ink text-left font-mono text-[11.5px] uppercase tracking-wider text-stone">
            <th scope="col" className="w-[34%] py-2 pr-2 font-medium">
              Обект
            </th>
            {showGrantor && (
              <th scope="col" className="w-[16%] py-2 pr-2 font-medium">
                Концедент
              </th>
            )}
            <th scope="col" className="w-[22%] py-2 pr-2 font-medium">
              Концесионер
            </th>
            <th
              scope="col"
              className="w-[10%] py-2 pr-2 text-right font-medium"
            >
              Срок
            </th>
            <th
              scope="col"
              className="w-[13%] py-2 pr-2 text-right font-medium"
            >
              Годишно
            </th>
            <th scope="col" className="w-[5%] py-2 font-medium">
              Инд.
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.reg_num} className="border-b border-limestone align-top">
              <td className="py-2 pr-2">
                <Link
                  to={concessionHref(r.slug)}
                  className="line-clamp-3 text-water underline decoration-1 underline-offset-2"
                  title={r.title}
                >
                  {r.title}
                </Link>
                <span className="block truncate font-mono text-xs text-stone">
                  {regNumLabel(r.reg_num)}
                </span>
              </td>
              {showGrantor && (
                <td className="py-2 pr-2">
                  {r.grantor_slug ? (
                    <Link
                      to={grantorHref(r.grantor_slug)}
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
                    to={companyHref(r.concessionaire_name ?? "", r.eik)}
                    className="line-clamp-2 text-ink hover:text-water"
                    title={r.concessionaire_name ?? undefined}
                  >
                    {r.concessionaire_name}
                  </Link>
                ) : (
                  <span
                    className="line-clamp-2"
                    title={r.concessionaire_name ?? undefined}
                  >
                    {r.concessionaire_name ?? "—"}
                  </span>
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
              <td
                className="py-2 pr-2 text-right font-mono tabular-nums"
                title={
                  annualLabel(r.annual_payment_raw, r.annual_payment_eur)
                    .full ?? undefined
                }
              >
                {annualLabel(r.annual_payment_raw, r.annual_payment_eur).text}
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
      <Prov href={csvHref} nofollow>
        CSV
      </Prov>
      {jsonHref && (
        <Prov href={jsonHref} nofollow>
          JSON
        </Prov>
      )}
    </div>
  );
}

/**
 * Откъс от търсенето в документите: snippet() маркира съвпаденията с
 * управляващи знаци, които тук стават <mark> — без innerHTML.
 */
export function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\u0001[^\u0002]*\u0002)/u);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("\u0001") ? (
          <mark key={i} className="bg-[#fff0b3] px-0.5 text-ink">
            {p.slice(1, -1)}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}
