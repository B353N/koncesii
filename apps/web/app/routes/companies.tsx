import { Link } from "react-router";
import type { Route } from "./+types/companies";
import { DataPending, ExportLinks, PageTitle } from "../components";
import { fmtEur } from "../format";
import { getSummary, listCompanies } from "../queries.server";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Компании — КОНЦЕСИИ" }];
}

export function loader({}: Route.LoaderArgs) {
  return { rows: listCompanies(), hasDb: getSummary() !== null };
}

export default function Companies({ loaderData }: Route.ComponentProps) {
  const { rows, hasDb } = loaderData;
  if (!hasDb) return <DataPending />;

  return (
    <>
      <PageTitle
        title="Компании"
        count={`${rows.length} концесионери, подредени по брой концесии`}
      />
      <ExportLinks csvHref="/companies.csv" />
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            <tr className="border-b-[1.5px] border-ink text-left font-mono text-[11.5px] uppercase tracking-wider text-stone">
              <th scope="col" className="py-2 pr-2 font-medium">
                Концесионер
              </th>
              <th scope="col" className="py-2 pr-2 font-medium">
                ЕИК
              </th>
              <th scope="col" className="py-2 pr-2 text-right font-medium">
                Концесии
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Общо годишно
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.idkey} className="border-b border-limestone">
                <td className="py-2 pr-2">
                  {r.eik ? (
                    <Link
                      to={`/companies/${r.eik}`}
                      className="text-water underline decoration-1 underline-offset-2"
                    >
                      {r.name}
                    </Link>
                  ) : (
                    r.name
                  )}
                </td>
                <td className="py-2 pr-2 font-mono text-[12.5px]">
                  {r.eik ?? "—"}
                </td>
                <td className="py-2 pr-2 text-right font-mono tabular-nums">
                  {r.concessions}
                </td>
                <td className="py-2 text-right font-mono tabular-nums whitespace-nowrap">
                  {fmtEur(r.total_annual_eur)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
