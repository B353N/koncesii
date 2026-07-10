import { Link } from "react-router";
import type { Route } from "./+types/flags";
import {
  DataPending,
  ExportLinks,
  FlagBadge,
  PageTitle,
  regNumLabel,
} from "../components";
import { fmtMonths } from "../format";
import { getSummary, listFlagCodes, listFlagged } from "../queries.server";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Индикатори за риск — КОНЦЕСИИ" },
    {
      name: "description",
      content:
        "Концесиите с индикатори за риск по публична, детерминистична методология. Всеки индикатор е възпроизводим аритметичен факт.",
    },
  ];
}

const SEVERITY_BY_CODE: Record<string, string> = {
  LOW_PAYMENT: "high",
  SINGLE_BIDDER: "high",
  YOUNG_COMPANY: "high",
  LONG_TERM: "medium",
  GRACE_PERIOD: "medium",
  NO_INDEXATION: "medium",
  MISSING_MONEY: "low",
  DATA_CONFLICT: "low",
};

export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const rows = listFlagged(code);

  return { rows, codes: listFlagCodes(), code, hasDb: getSummary() !== null };
}

export default function Flags({ loaderData }: Route.ComponentProps) {
  const { rows, codes, code, hasDb } = loaderData;
  if (!hasDb) return <DataPending />;

  return (
    <>
      <PageTitle
        title="Индикатори за риск"
        count={
          <>
            {rows.length} {rows.length === 1 ? "концесия" : "концесии"} с поне
            един индикатор · всеки е възпроизводим аритметичен факт по{" "}
            <Link
              to="/methodology"
              className="text-water underline underline-offset-2"
            >
              публичната методология
            </Link>
          </>
        }
      />
      <div className="mt-4 flex flex-wrap gap-2 text-[13px]">
        <Link
          to="/flags"
          className={
            !code
              ? "rounded-[2px] border border-water bg-[#eef3f0] px-2.5 py-1 text-water no-underline"
              : "rounded-[2px] border border-limestone bg-raised px-2.5 py-1 text-ink/80 no-underline hover:border-water"
          }
        >
          Всички
        </Link>
        {codes.map((c) => (
          <Link
            key={c.code}
            to={`/flags?code=${c.code}`}
            className={
              code === c.code
                ? "rounded-[2px] border border-water bg-[#eef3f0] px-2.5 py-1 font-mono text-water no-underline"
                : "rounded-[2px] border border-limestone bg-raised px-2.5 py-1 font-mono text-ink/80 no-underline hover:border-water"
            }
          >
            {c.code} · {c.n}
          </Link>
        ))}
      </div>
      <ExportLinks csvHref={`/flags.csv${code ? `?code=${code}` : ""}`} />
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            <tr className="border-b-[1.5px] border-ink text-left font-mono text-[11.5px] uppercase tracking-wider text-stone">
              <th scope="col" className="py-2 pr-2 font-medium">
                Концесия
              </th>
              <th scope="col" className="py-2 pr-2 font-medium">
                Концедент
              </th>
              <th scope="col" className="py-2 pr-2 font-medium">
                Индикатори
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Срок
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.reg_num}
                className="border-b border-limestone align-top"
              >
                <td className="py-2.5 pr-2">
                  <Link
                    to={`/concessions/${encodeURIComponent(r.reg_num)}`}
                    className="line-clamp-3 text-water underline decoration-1 underline-offset-2"
                    title={r.title}
                  >
                    {r.title}
                  </Link>
                  <span className="block truncate font-mono text-xs text-stone">
                    {regNumLabel(r.reg_num)}
                  </span>
                </td>
                <td className="py-2.5 pr-2">{r.grantor_name ?? "—"}</td>
                <td className="py-2.5 pr-2">
                  <span className="flex flex-wrap gap-1.5">
                    {r.flag_codes.split(",").map((fc) => (
                      <FlagBadge
                        key={fc}
                        code={fc}
                        severity={SEVERITY_BY_CODE[fc] ?? "low"}
                      />
                    ))}
                  </span>
                </td>
                <td className="py-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                  {fmtMonths(r.term_months)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
