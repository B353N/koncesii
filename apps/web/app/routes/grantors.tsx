import { Link } from "react-router";
import type { Route } from "./+types/grantors";
import { DataPending, ExportLinks, PageTitle } from "../components";
import { getSummary, listGrantors } from "../queries.server";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Концеденти — КОНЦЕСИИ" }];
}

const KIND: Record<string, string> = {
  municipality: "община",
  minister: "министър",
  other: "друг орган",
};

export function loader({}: Route.LoaderArgs) {
  return { rows: listGrantors(), hasDb: getSummary() !== null };
}

export default function Grantors({ loaderData }: Route.ComponentProps) {
  const { rows, hasDb } = loaderData;
  if (!hasDb) return <DataPending />;

  return (
    <>
      <PageTitle
        title="Концеденти"
        count={`${rows.length} органа, отдали концесии`}
      />
      <ExportLinks csvHref="/grantors.csv" />
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            <tr className="border-b-[1.5px] border-ink text-left font-mono text-[11.5px] uppercase tracking-wider text-stone">
              <th scope="col" className="py-2 pr-2 font-medium">
                Орган
              </th>
              <th scope="col" className="py-2 pr-2 font-medium">
                Вид
              </th>
              <th scope="col" className="py-2 pr-2 text-right font-medium">
                Концесии
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                С индикатор
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.slug} className="border-b border-limestone">
                <td className="py-2 pr-2">
                  <Link
                    to={`/grantors/${encodeURIComponent(r.slug)}`}
                    className="text-water underline decoration-1 underline-offset-2"
                  >
                    {r.name}
                  </Link>
                </td>
                <td className="py-2 pr-2 text-stone">
                  {KIND[r.kind] ?? r.kind}
                </td>
                <td className="py-2 pr-2 text-right font-mono tabular-nums">
                  {r.concessions}
                </td>
                <td className="py-2 text-right font-mono tabular-nums">
                  {r.flagged || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
