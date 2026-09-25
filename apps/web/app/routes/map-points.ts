import { mapPoints } from "../queries.server";

/**
 * Resource route: /map-points.json - точките на картата с индикаторите им.
 * Картата го тегли след като страницата вече е показана, за да не тежи
 * в HTML-а; списъкът до картата е рендиран на сървъра.
 */
export function loader() {
  return new Response(JSON.stringify(mapPoints()), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
