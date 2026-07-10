import { useEffect, useRef, useState } from "react";
import type { Route } from "./+types/map";
import { DataPending, PageTitle } from "../components";
import { KIND_LABELS } from "../format";
import { getDb } from "../db.server";
import { getSummary } from "../queries.server";
import "maplibre-gl/dist/maplibre-gl.css";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Карта на концесиите — КОНЦЕСИИ" },
    {
      name: "description",
      content:
        "Гео-кодираните обекти на концесии в България: язовири, плажове, находища — върху карта, с връзка към партидата на всяка сделка.",
    },
  ];
}

export function loader({}: Route.LoaderArgs) {
  const db = getDb();
  const geocoded =
    db
      ?.prepare<[], { n: number }>(
        "SELECT COUNT(*) AS n FROM objects WHERE lat IS NOT NULL",
      )
      .get()?.n ?? 0;
  const total =
    db?.prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM objects").get()
      ?.n ?? 0;
  return { geocoded, total, hasDb: getSummary() !== null };
}

/** Цветове по вид — само от „вода/камък" семейството (oxide/ochre са за флагове). */
const KIND_COLORS: Record<string, string> = {
  dam: "#14464c",
  beach: "#0f6a6b",
  mineral_water: "#3d7d7c",
  port: "#1b2a2c",
  mining: "#5e6e6c",
  quarry: "#7d8a88",
};
const DEFAULT_COLOR = "#8a9694";

function MapIsland() {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let map: import("maplibre-gl").Map | undefined;
    let cancelled = false;

    import("maplibre-gl")
      .then(({ default: maplibregl }) => {
        if (cancelled || !container.current) return;
        map = new maplibregl.Map({
          container: container.current,
          center: [25.3, 42.75],
          zoom: 6.4,
          // журналистите правят screenshot-и на картата
          canvasContextAttributes: { preserveDrawingBuffer: true },
          style: {
            version: 8,
            sources: {
              osm: {
                type: "raster",
                tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
                tileSize: 256,
                attribution: "© OpenStreetMap contributors",
              },
            },
            layers: [{ id: "osm", type: "raster", source: "osm" }],
          },
        });
        map.addControl(
          new maplibregl.NavigationControl({ showCompass: false }),
        );
        map.on("error", (e) => console.error("[map]", e.error?.message ?? e));

        map.on("load", () => {
          if (!map) return;
          map.addSource("koncesii", {
            type: "geojson",
            data: "/map.geojson",
            cluster: true,
            clusterMaxZoom: 11,
            clusterRadius: 44,
          });
          map.addLayer({
            id: "clusters",
            type: "circle",
            source: "koncesii",
            filter: ["has", "point_count"],
            paint: {
              "circle-color": "#14464c",
              "circle-opacity": 0.85,
              "circle-radius": [
                "step",
                ["get", "point_count"],
                14,
                10,
                18,
                40,
                24,
              ],
              "circle-stroke-width": 1.5,
              "circle-stroke-color": "#fbfbf8",
            },
          });
          map.addLayer({
            id: "points",
            type: "circle",
            source: "koncesii",
            filter: ["!", ["has", "point_count"]],
            paint: {
              "circle-color": [
                "match",
                ["get", "kind"],
                "dam",
                KIND_COLORS["dam"]!,
                "beach",
                KIND_COLORS["beach"]!,
                "mineral_water",
                KIND_COLORS["mineral_water"]!,
                "port",
                KIND_COLORS["port"]!,
                "mining",
                KIND_COLORS["mining"]!,
                "quarry",
                KIND_COLORS["quarry"]!,
                DEFAULT_COLOR,
              ],
              "circle-radius": 6.5,
              "circle-opacity": 0.9,
              "circle-stroke-width": 1.5,
              "circle-stroke-color": "#fbfbf8",
            },
          });

          map.on("click", "clusters", (e) => {
            const f = map!.queryRenderedFeatures(e.point, {
              layers: ["clusters"],
            })[0];
            if (!f) return;
            const clusterId = f.properties["cluster_id"] as number;
            const src = map!.getSource(
              "koncesii",
            ) as import("maplibre-gl").GeoJSONSource;
            void src.getClusterExpansionZoom(clusterId).then((zoom) => {
              map!.easeTo({
                center: (f.geometry as { coordinates: [number, number] })
                  .coordinates,
                zoom,
              });
            });
          });
          map.on("click", "points", (e) => {
            const f = e.features?.[0];
            if (!f) return;
            const p = f.properties as {
              reg_num: string;
              title: string;
              kind: string;
              precision: string;
            };
            const el = document.createElement("div");
            el.className = "font-sans text-[13px] leading-snug";
            el.innerHTML =
              `<a href="/concessions/${encodeURIComponent(p.reg_num)}" class="text-water underline">` +
              `${escapeHtml(p.title)}</a>` +
              `<div class="mt-1 text-stone">${escapeHtml(kindLabel(p.kind))} · ` +
              `${p.precision === "municipality" ? "приблизително (община)" : "приблизително (нас. място)"}</div>`;
            new maplibregl.Popup({ maxWidth: "280px" })
              .setLngLat(
                (f.geometry as { coordinates: [number, number] }).coordinates,
              )
              .setDOMContent(el)
              .addTo(map!);
          });
          for (const layer of ["clusters", "points"]) {
            map.on("mouseenter", layer, () => {
              map!.getCanvas().style.cursor = "pointer";
            });
            map.on("mouseleave", layer, () => {
              map!.getCanvas().style.cursor = "";
            });
          }
        });
      })
      .catch(() => setFailed(true));

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, []);

  if (failed) {
    return (
      <p className="my-10 text-stone">
        Картата не можа да се зареди. Данните са достъпни и като{" "}
        <a href="/map.geojson" className="text-water underline">
          GeoJSON
        </a>
        .
      </p>
    );
  }
  return (
    <div
      ref={container}
      className="mt-5 h-[68vh] min-h-[420px] w-full rounded-[3px] border border-limestone bg-raised"
      role="application"
      aria-label="Карта на концесиите"
    />
  );
}

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export default function MapPage({ loaderData }: Route.ComponentProps) {
  const { geocoded, total, hasDb } = loaderData;
  if (!hasDb) return <DataPending />;

  return (
    <>
      <PageTitle
        title="Карта"
        count={
          <>
            {geocoded} от {total} обекта с локация от обявленията · центроиди на
            населени места/общини — <b>приблизителни</b>, партидата носи точното
            описание
          </>
        }
      />
      <MapIsland />
      <p className="mt-3 text-xs text-stone">
        Локациите са извлечени от полето „Местонахождение" на обявленията в НКР
        и гео-кодирани по центроиди от{" "}
        <a href="https://www.geonames.org" rel="noopener" className="underline">
          GeoNames
        </a>{" "}
        (CC BY 4.0). Тайлове: ©{" "}
        <a
          href="https://www.openstreetmap.org/copyright"
          rel="noopener"
          className="underline"
        >
          OpenStreetMap
        </a>{" "}
        contributors.
      </p>
    </>
  );
}
