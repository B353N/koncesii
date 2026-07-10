import { getDb } from "../db.server";

/** Resource route: /map.geojson — precompute от ingest, никога на живо. */
export function loader() {
  const db = getDb();
  const row = db
    ?.prepare<[], { payload: string }>(
      "SELECT payload FROM rollups WHERE key = 'map_geojson'",
    )
    .get();
  return new Response(
    row?.payload ?? '{"type":"FeatureCollection","features":[]}',
    {
      headers: {
        "Content-Type": "application/geo+json; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
}
