import { csvResponse, toCsv } from "../format";
import { listCompanies } from "../queries.server";

/** Resource route: /companies.csv */
export function loader() {
  const rows = listCompanies();
  return csvResponse(
    "kompanii.csv",
    toCsv(
      ["Концесионер", "ЕИК", "Концесии", "Общо годишно (EUR)"],
      rows.map((r) => [r.name, r.eik, r.concessions, r.total_annual_eur]),
    ),
  );
}
