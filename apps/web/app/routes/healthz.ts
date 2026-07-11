import { getSummary } from "../queries.server";

/**
 * Resource route: /healthz — status endpoint-ът от /.well-known/api-catalog
 * (RFC 9727) и проверката на Coolify. "ok" изисква жива база; сайтът работи
 * и без нея ("degraded"), затова статус кодът остава 200 и в двата случая.
 */
export function loader() {
  const summary = getSummary();
  return Response.json(
    summary
      ? { status: "ok", data_date: summary.data_date }
      : { status: "degraded", detail: "database not loaded" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
