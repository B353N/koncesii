import type { Route } from "./+types/flags-csv";
import { csvResponse, toCsv } from "../format";
import { listFlagged } from "../queries.server";

/** Resource route: /flags.csv */
export function loader({ request }: Route.LoaderArgs) {
  const rows = listFlagged(new URL(request.url).searchParams.get("code"));
  return csvResponse(
    "indikatori.csv",
    toCsv(
      [
        "Партида",
        "Обект",
        "Концедент",
        "Индикатори",
        "Срок (месеци)",
        "Годишно (източник)",
      ],
      rows.map((r) => [
        r.reg_num,
        r.title,
        r.grantor_name,
        r.flag_codes,
        r.term_months,
        r.annual_payment_raw,
      ]),
    ),
  );
}
