import { csvResponse, toCsv } from "../format";
import { listGrantors } from "../queries.server";

const KIND: Record<string, string> = {
  municipality: "община",
  minister: "министър",
  other: "друг орган",
};

/** Resource route: /grantors.csv */
export function loader() {
  const rows = listGrantors();
  return csvResponse(
    "koncedenti.csv",
    toCsv(
      ["Концедент", "Вид", "Концесии", "С индикатор"],
      rows.map((r) => [
        r.name,
        KIND[r.kind] ?? r.kind,
        r.concessions,
        r.flagged,
      ]),
    ),
  );
}
