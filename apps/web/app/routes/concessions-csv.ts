import type { Route } from "./+types/concessions-csv";
import { csvResponse, toCsv } from "../format";
import { listConcessions } from "../queries.server";

/** Resource route: /concessions.csv — списъкът с текущите филтри като CSV. */
export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const { rows } = listConcessions({
    kind: url.searchParams.get("kind"),
    status: url.searchParams.get("status"),
    flagged: url.searchParams.get("flagged") === "1",
    q: url.searchParams.get("q"),
    limit: 100000,
  });
  return csvResponse(
    "koncesii.csv",
    toCsv(
      [
        "Партида",
        "Обект",
        "Статус",
        "Концедент",
        "Концесионер",
        "ЕИК",
        "Срок (месеци)",
        "Годишно (източник)",
        "Годишно (EUR)",
      ],
      rows.map((r) => [
        r.reg_num,
        r.title,
        r.status,
        r.grantor_name,
        r.concessionaire_name,
        r.eik,
        r.term_months,
        r.annual_payment_raw,
        r.annual_payment_eur,
      ]),
    ),
  );
}
