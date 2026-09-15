import { getDb } from "../db.server";
import { concessionSlug } from "../queries.server";

/**
 * Resource route: /map.geojson - precompute от ingest, никога на живо.
 * Единствената добавка е properties.slug, за да сочат popup-ите на
 * картата към каноничния адрес на партидата.
 */
export function loader() {
  const db = getDb();
  const row = db
    ?.prepare<[], { payload: string }>(
      "SELECT payload FROM rollups WHERE key = 'map_geojson'",
    )
    .get();
  let payload = '{"type":"FeatureCollection","features":[]}';
  if (row) {
    const fc = JSON.parse(row.payload) as {
      features: Array<{ properties: { reg_num: string; slug?: string } }>;
    };
    for (const f of fc.features)
      f.properties.slug = concessionSlug(f.properties.reg_num);
    payload = JSON.stringify(fc);
  }
  return new Response(payload, {
    headers: {
      "Content-Type": "application/geo+json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
