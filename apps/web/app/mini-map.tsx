import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { Map as MlMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { pinImage } from "./map-pin";
import { BASEMAP_STYLE } from "./map-style";
import { PATHS } from "./paths";

/**
 * Малка карта на мястото на обекта за страницата на партидата: едно
 * флагче, без взаимодействие, с връзка към голямата карта. Точката е
 * центроид на населеното място или общината - приблизителна, и това е
 * казано под картата. MapLibre се тегли чак в браузъра.
 */
export function MiniMap({
  lat,
  lon,
  kind,
  sev,
  precision,
  label,
}: {
  lat: number;
  lon: number;
  kind: string;
  sev: number;
  precision: string | null;
  label: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let map: MlMap | undefined;
    let cancelled = false;
    import("maplibre-gl")
      .then((maplibregl) => {
        if (cancelled || !container.current) return;
        maplibregl.setWorkerUrl(maplibreWorkerUrl);
        map = new maplibregl.Map({
          container: container.current,
          style: BASEMAP_STYLE,
          center: [lon, lat],
          zoom: precision === "municipality" ? 8.6 : 10.2,
          interactive: false,
          attributionControl: { compact: true },
        });
        map.once("style.load", () => {
          if (!map) return;
          for (const l of map.getStyle().layers) {
            if (l.type === "symbol" && l.layout && "text-field" in l.layout)
              map.setLayoutProperty(l.id, "text-field", [
                "coalesce",
                ["get", "name:bg"],
                ["get", "name"],
              ]);
          }
          map.addImage("pin", pinImage(Math.max(1, sev), kind), {
            pixelRatio: 2,
          });
          map.addSource("pt", {
            type: "geojson",
            data: {
              type: "Feature",
              geometry: { type: "Point", coordinates: [lon, lat] },
              properties: {},
            },
          });
          map.addLayer({
            id: "pt",
            type: "symbol",
            source: "pt",
            layout: {
              "icon-image": "pin",
              "icon-anchor": "bottom-left",
              "icon-offset": [-6, 2],
              "icon-allow-overlap": true,
            },
          });
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [lat, lon, kind, sev, precision]);

  return (
    <figure className="overflow-hidden rounded-2xl bg-raised">
      <div className="relative h-[240px] bg-[#f1f3ee]">
        <div ref={container} className="h-full w-full" aria-hidden="true" />
        {failed && (
          <p className="absolute inset-x-4 top-4 text-[13px] text-stone">
            Картата не можа да се зареди.
          </p>
        )}
        <Link
          to={`${PATHS.map}#${lat.toFixed(3)},${lon.toFixed(3)}`}
          className="absolute right-3 bottom-3 rounded-full bg-ink px-3 py-1.5 text-[13px] font-bold text-white no-underline"
        >
          На голямата карта
        </Link>
      </div>
      <figcaption className="px-4 py-2.5 text-[13px] text-stone">
        {label}. Точката е приблизителна: центърът на{" "}
        {precision === "municipality" ? "общината" : "населеното място"}.
      </figcaption>
    </figure>
  );
}
