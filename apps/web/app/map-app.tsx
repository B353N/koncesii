import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Form, Link } from "react-router";
import type { Map as MlMap, GeoJSONSource, Popup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// maplibre-gl 6 е само ESM и не вгражда worker-а като blob: - Vite го
// бъндълва като самостоятелен файл (?worker&url) и го подаваме през
// setWorkerUrl преди първата карта. Същият origin → покрива се от
// worker-src 'self' в CSP (entry.server.tsx).
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { FLAG_DESCRIPTIONS, KIND_LABELS } from "./format";
import {
  BASEMAP_STYLE,
  BG_BOUNDS,
  DEFAULT_KIND_COLOR,
  KIND_COLORS,
  MAX_BOUNDS,
  SEV_COLORS,
} from "./map-style";
import type { MapPoint } from "./queries.server";
import { concessionHref } from "./slug";

/** Кратките имена на индикаторите за флагчетата в списъка. */
export const FLAG_SHORT: Record<string, string> = {
  LOW_PAYMENT: "Ниско възнаграждение",
  SINGLE_BIDDER: "Един участник",
  YOUNG_COMPANY: "Нова компания",
  LONG_TERM: "Дълъг срок",
  GRACE_PERIOD: "Гратисен период",
  NO_INDEXATION: "Без индексация",
  MISSING_MONEY: "Без вписана сума",
  DATA_CONFLICT: "Противоречие в данните",
};
const FLAG_SEV: Record<string, number> = {
  LOW_PAYMENT: 3,
  SINGLE_BIDDER: 3,
  YOUNG_COMPANY: 3,
  LONG_TERM: 2,
  GRACE_PERIOD: 2,
  NO_INDEXATION: 2,
  MISSING_MONEY: 1,
  DATA_CONFLICT: 1,
};
const PILL: Record<number, string> = {
  1: "bg-[#eef1f3] text-[#4d5a64]",
  2: "bg-[#fdf0d6] text-[#7a5200]",
  3: "bg-[#fbe3dd] text-[#a2301b]",
};

const eur0 = new Intl.NumberFormat("bg-BG", { maximumFractionDigits: 0 });
const nf = new Intl.NumberFormat("bg-BG");
function termLabel(m: number | null): string {
  if (m == null) return "няма данни";
  return m % 12 === 0 ? `${m / 12} г.` : `${m} мес.`;
}
function eurLabel(v: number | null): string {
  return v == null ? "няма данни" : `${eur0.format(v)} €`;
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Флагчето: пилон + флаг в цвета на тежестта. 0 = точка във вида обект. */
export function FlagPin({ sev, kind }: { sev: number; kind?: string }) {
  if (!sev)
    return (
      <svg width="18" height="22" aria-hidden="true" className="flex-none">
        <circle
          cx="7"
          cy="12"
          r="5"
          fill={KIND_COLORS[kind ?? ""] ?? DEFAULT_KIND_COLOR}
        />
      </svg>
    );
  return (
    <svg
      width="18"
      height="22"
      viewBox="0 0 26 34"
      aria-hidden="true"
      className="flex-none"
    >
      <path
        d="M6 30V3"
        stroke="var(--color-ink)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M7 3c5-2 9 3 16 .5L21 10l2 6.5c-7 2.5-11-2.5-16-.5z"
        fill={SEV_COLORS[sev]}
      />
    </svg>
  );
}

export function FlagPills({ flags }: { flags: string[] }) {
  if (!flags.length) return null;
  return (
    <span className="mt-1.5 flex flex-wrap gap-1">
      {flags.map((f) => (
        <span
          key={f}
          title={FLAG_DESCRIPTIONS[f]}
          className={`rounded-md px-2 py-px text-[12px] font-bold ${PILL[FLAG_SEV[f] ?? 1]}`}
        >
          {FLAG_SHORT[f] ?? f}
        </span>
      ))}
    </span>
  );
}

/** Флагче за картата, нарисувано в canvas (иконата на symbol слоя). */
function pinImage(sev: number, kind: string): ImageData {
  const s = 2;
  const c = document.createElement("canvas");
  c.width = 26 * s;
  c.height = 34 * s;
  const g = c.getContext("2d")!;
  g.scale(s, s);
  g.fillStyle = "rgba(21,33,43,.18)";
  g.beginPath();
  g.ellipse(6, 31, 5, 2, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#15212b";
  g.lineWidth = 2;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(6, 30);
  g.lineTo(6, 3);
  g.stroke();
  g.fillStyle = SEV_COLORS[sev]!;
  g.beginPath();
  g.moveTo(7, 3);
  g.bezierCurveTo(12, 1, 16, 6, 23, 3.5);
  g.lineTo(21, 10);
  g.lineTo(23, 16.5);
  g.bezierCurveTo(16, 19, 12, 14, 7, 16);
  g.closePath();
  g.fill();
  g.fillStyle = "#fff";
  g.beginPath();
  g.arc(6, 30, 3.6, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = KIND_COLORS[kind] ?? DEFAULT_KIND_COLOR;
  g.beginPath();
  g.arc(6, 30, 2.4, 0, Math.PI * 2);
  g.fill();
  return g.getImageData(0, 0, c.width, c.height);
}

function toGeoJson(points: MapPoint[], idx: Map<MapPoint, number>) {
  return {
    type: "FeatureCollection" as const,
    features: points.map((p) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] },
      properties: { i: idx.get(p)!, k: p.kind, sev: p.sev },
    })),
  };
}

export interface MapAppProps {
  heading: ReactNode;
  intro: ReactNode;
  /** първите партиди по тежест - рендират се на сървъра като връзки */
  initial: MapPoint[];
  kinds: Array<{ kind: string; n: number }>;
  geocoded: number;
  total: number;
}

const LIST_LIMIT = 80;

export function MapApp({
  heading,
  intro,
  initial,
  kinds,
  geocoded,
  total,
}: MapAppProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const [points, setPoints] = useState<MapPoint[] | null>(null);
  const [bounds, setBounds] = useState<[number, number, number, number]>();
  const [kindOn, setKindOn] = useState<Set<string>>(new Set());
  const [only, setOnly] = useState(false);
  const [q, setQ] = useState("");
  const [failed, setFailed] = useState(false);
  const ready = points !== null;

  const index = useMemo(
    () => new Map((points ?? []).map((p, i) => [p, i] as const)),
    [points],
  );
  const filtered = useMemo(() => {
    if (!points) return [];
    const needle = q.trim().toLowerCase();
    return points.filter(
      (p) =>
        (!kindOn.size || kindOn.has(p.kind)) &&
        (!only || p.sev >= 2) &&
        (!needle ||
          `${p.label} ${p.company ?? ""} ${p.municipality ?? ""} ${p.reg_num}`
            .toLowerCase()
            .includes(needle)),
    );
  }, [points, kindOn, only, q]);
  const inView = useMemo(() => {
    if (!bounds) return filtered;
    const [w, s, e, n] = bounds;
    return filtered.filter(
      (p) => p.lon >= w && p.lon <= e && p.lat >= s && p.lat <= n,
    );
  }, [filtered, bounds]);
  const list = ready ? inView : initial;

  // картата: динамичен import след хидратация, данните паралелно
  useEffect(() => {
    let cancelled = false;
    let map: MlMap | undefined;
    const data = fetch("/map-points.json").then(
      (r) => r.json() as Promise<MapPoint[]>,
    );
    Promise.all([import("maplibre-gl"), data])
      .then(([maplibregl, pts]) => {
        if (cancelled || !container.current) return;
        maplibregl.setWorkerUrl(maplibreWorkerUrl);
        map = new maplibregl.Map({
          container: container.current,
          style: BASEMAP_STYLE,
          bounds: BG_BOUNDS,
          fitBoundsOptions: { padding: 32 },
          maxBounds: MAX_BOUNDS,
          attributionControl: { compact: true },
          cooperativeGestures: window.matchMedia("(max-width: 1023px)").matches,
          // журналистите правят screenshot-и на картата
          canvasContextAttributes: { preserveDrawingBuffer: true },
        });
        mapRef.current = map;
        map.addControl(
          new maplibregl.NavigationControl({ showCompass: false }),
          "top-right",
        );
        map.on("error", (e) => console.error("[map]", e.error?.message ?? e));
        // style.load, не load: маркерите се показват, без да чакат всички плочки
        map.once("style.load", () => {
          if (!map) return;
          styleBasemap(map);
          for (const sev of [1, 2, 3])
            for (const k of Object.keys(KIND_COLORS))
              map.addImage(`f${sev}${k}`, pinImage(sev, k), { pixelRatio: 2 });
          const idx = new Map(pts.map((p, i) => [p, i] as const));
          map.addSource("pts", {
            type: "geojson",
            data: toGeoJson(pts, idx),
            cluster: true,
            clusterRadius: 42,
            clusterMaxZoom: 9,
            clusterProperties: { maxSev: ["max", ["get", "sev"]] },
          });
          addLayers(map);
          wireEvents(map, maplibregl.Popup, pts);
          setPoints(pts);
          const b = map.getBounds();
          setBounds([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
        });
        map.on("moveend", () => {
          const b = map!.getBounds();
          setBounds([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
        });
      })
      .catch((e) => {
        console.error("[map]", e);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // филтрите сменят и точките на картата
  useEffect(() => {
    const src = mapRef.current?.getSource("pts") as GeoJSONSource | undefined;
    if (src && points) src.setData(toGeoJson(filtered, index));
  }, [filtered, index, points]);

  function wireEvents(map: MlMap, PopupCtor: typeof Popup, pts: MapPoint[]) {
    map.on("click", "cl", async (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const src = map.getSource("pts") as GeoJSONSource;
      const z = await src.getClusterExpansionZoom(
        f.properties["cluster_id"] as number,
      );
      map.easeTo({
        center: (f.geometry as { coordinates: [number, number] }).coordinates,
        zoom: z + 0.3,
      });
    });
    for (const layer of ["pin", "dot"]) {
      map.on("click", layer, (e) => {
        const i = e.features?.[0]?.properties["i"] as number | undefined;
        if (i != null) openPopup(map, PopupCtor, pts[i]!);
      });
      map.on("mouseenter", layer, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layer, () => {
        map.getCanvas().style.cursor = "";
      });
    }
    map.on("mouseenter", "cl", () => {
      map.getCanvas().style.cursor = "zoom-in";
    });
    map.on("mouseleave", "cl", () => {
      map.getCanvas().style.cursor = "";
    });
  }

  function openPopup(map: MlMap, PopupCtor: typeof Popup, p: MapPoint) {
    popupRef.current?.remove();
    const el = document.createElement("div");
    el.className = "font-sans text-[14px] leading-snug text-ink";
    el.innerHTML =
      `<div class="text-[12.5px] font-semibold text-stone">${escapeHtml(KIND_LABELS[p.kind] ?? "Обект")}${p.municipality ? `, община ${escapeHtml(p.municipality)}` : ""}</div>` +
      `<div class="mt-1 text-[15.5px] font-bold">${escapeHtml(p.label)}</div>` +
      `<div class="mt-0.5 text-[13px] text-stone">${
        p.company
          ? p.company_eik
            ? `<a class="text-water underline" href="/companies/${encodeURIComponent(p.company_eik)}">${escapeHtml(p.company)}</a>`
            : escapeHtml(p.company)
          : "Концесионерът не е вписан"
      }</div>` +
      `<div class="my-2.5 flex gap-5"><div><span class="block text-[12px] text-stone">Срок</span><b class="text-[16px]">${termLabel(p.term_months)}</b></div>` +
      `<div><span class="block text-[12px] text-stone">Годишно</span><b class="text-[16px]">${eurLabel(p.annual_payment_eur)}</b></div></div>` +
      `<div class="flex flex-wrap gap-1">${p.flags
        .map(
          (f) =>
            `<span title="${escapeHtml(FLAG_DESCRIPTIONS[f] ?? "")}" class="rounded-md px-2 py-px text-[12px] font-bold ${PILL[FLAG_SEV[f] ?? 1]}">${escapeHtml(FLAG_SHORT[f] ?? f)}</span>`,
        )
        .join("")}</div>` +
      `<a class="mt-3 inline-block rounded-[10px] bg-ink px-3.5 py-2 font-bold text-white no-underline" href="${concessionHref(p.slug)}">Отвори партида ${escapeHtml(p.reg_num)}</a>`;
    popupRef.current = new PopupCtor({ offset: [4, -30], maxWidth: "320px" })
      .setLngLat([p.lon, p.lat])
      .setDOMContent(el)
      .addTo(map);
  }

  async function showOnMap(p: MapPoint) {
    const map = mapRef.current;
    if (!map) return;
    const { Popup: PopupCtor } = await import("maplibre-gl");
    map.flyTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 10.5) });
    map.once("moveend", () => openPopup(map, PopupCtor, p));
    if (window.matchMedia("(max-width: 1023px)").matches)
      container.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function highlight(p: MapPoint | null) {
    const map = mapRef.current;
    if (!map?.getLayer("sel")) return;
    map.setFilter("sel", ["==", ["get", "i"], p ? index.get(p)! : -1]);
  }

  function toggleKind(k: string | null) {
    setKindOn((prev) => {
      if (k === null) return new Set();
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  return (
    <div className="grid lg:h-[calc(100dvh-58px)] lg:min-h-[600px] lg:grid-cols-[420px_1fr]">
      <aside className="flex min-h-0 flex-col border-limestone bg-raised lg:border-r">
        <div className="border-b border-limestone px-4 pt-6 pb-4 sm:px-[22px]">
          {heading}
          <div className="mt-2 mb-4 text-stone">{intro}</div>
          <Form action="/search" className="relative">
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              className="absolute top-1/2 left-[13px] -translate-y-1/2 text-stone"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-4-4" />
            </svg>
            <input
              type="search"
              name="q"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Търсене на обект, община, фирма или партида"
              placeholder="Плаж, община, фирма или партида"
              className="w-full rounded-xl border-[1.5px] border-limestone bg-paper py-3 pr-3.5 pl-10 text-[15px] focus:border-water focus:bg-raised focus:outline-none"
            />
          </Form>
          <div
            className="mt-3.5 flex flex-wrap gap-1.5"
            role="group"
            aria-label="Вид обект"
          >
            <button
              type="button"
              aria-pressed={!kindOn.size}
              onClick={() => toggleKind(null)}
              className={chip(!kindOn.size)}
            >
              Всички
            </button>
            {kinds.map(({ kind, n }) => (
              <button
                key={kind}
                type="button"
                aria-pressed={kindOn.has(kind)}
                onClick={() => toggleKind(kind)}
                className={chip(kindOn.has(kind))}
              >
                <i
                  className="inline-block h-[9px] w-[9px] rounded-full"
                  style={{
                    background: KIND_COLORS[kind] ?? DEFAULT_KIND_COLOR,
                  }}
                />
                {KIND_LABELS[kind] ?? kind}
                <span className="font-medium opacity-60">{n}</span>
              </button>
            ))}
          </div>
          <label className="mt-3.5 flex cursor-pointer items-center gap-2.5 text-[14px] font-semibold">
            <input
              type="checkbox"
              checked={only}
              onChange={(e) => setOnly(e.target.checked)}
              className="h-[18px] w-[18px] accent-ink"
            />
            Само средна и висока тежест
          </label>
        </div>
        <div className="flex justify-between border-b border-limestone px-4 py-2.5 text-[13.5px] text-stone sm:px-[22px]">
          <span>
            {ready ? "В изгледа" : "Партиди на картата"}:{" "}
            <b className="text-ink">
              {nf.format(ready ? list.length : geocoded)}
            </b>
          </span>
          <span>подредени по тежест</span>
        </div>
        <ul className="min-h-0 lg:flex-1 lg:overflow-y-auto">
          {list.slice(0, LIST_LIMIT).map((p) => (
            <li
              key={p.reg_num}
              className="grid grid-cols-[22px_1fr_auto] gap-2.5 border-b border-limestone px-4 py-3.5 hover:bg-[#f5f8f8] sm:px-[22px]"
              onMouseEnter={() => highlight(p)}
              onMouseLeave={() => highlight(null)}
            >
              <FlagPin sev={p.sev} kind={p.kind} />
              <div className="min-w-0">
                <Link
                  to={concessionHref(p.slug)}
                  className="font-bold leading-snug text-ink no-underline hover:text-water hover:underline"
                >
                  {p.label}
                </Link>
                <div className="mt-0.5 text-[13.5px] text-stone">
                  {p.company ?? "концесионерът не е вписан"}
                  {p.annual_payment_eur != null &&
                    `, ${eurLabel(p.annual_payment_eur)} годишно`}
                </div>
                <FlagPills flags={p.flags} />
              </div>
              {ready && (
                <button
                  type="button"
                  onClick={() => void showOnMap(p)}
                  aria-label={`Покажи на картата: ${p.label}`}
                  title="Покажи на картата"
                  className="h-8 w-8 self-start rounded-full text-stone hover:bg-paper hover:text-ink"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    className="mx-auto"
                    aria-hidden="true"
                  >
                    <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
                    <circle cx="12" cy="9.5" r="2.5" />
                  </svg>
                </button>
              )}
            </li>
          ))}
          {ready && !list.length && (
            <li className="px-[22px] py-6 text-stone">
              Няма обекти в този изглед. Отдалечете картата или махнете филтър.
            </li>
          )}
          {list.length > LIST_LIMIT && (
            <li className="px-[22px] py-4 text-[14px]">
              <Link to="/concessions" className="font-semibold text-water">
                Още {nf.format(list.length - LIST_LIMIT)} в този изглед. Вижте
                всички концесии
              </Link>
            </li>
          )}
        </ul>
      </aside>

      <div className="relative order-first h-[62vh] min-h-[360px] min-w-0 bg-[#f1f3ee] lg:order-none lg:h-auto">
        {/* maplibre-gl.css слага position: relative на контейнера - затова
            абсолютната позиция е на обвивката, а контейнерът е 100% */}
        <div className="absolute inset-0">
          <div
            ref={container}
            className="h-full w-full"
            role="region"
            aria-label="Карта на концесиите"
          />
        </div>
        {failed && (
          <p className="absolute inset-x-4 top-4 rounded-xl bg-raised p-4 text-stone">
            Картата не можа да се зареди. Списъкът вляво работи, а данните са
            достъпни и като{" "}
            <a href="/map.geojson" className="text-water underline">
              GeoJSON
            </a>
            .
          </p>
        )}
        <p className="absolute bottom-4 left-4 z-[2] hidden max-w-[340px] rounded-xl bg-raised/95 px-3.5 py-2.5 text-[13px] text-stone shadow-[0_4px_16px_rgba(21,33,43,.1)] lg:block">
          <b className="text-ink">
            {nf.format(geocoded)} от {nf.format(total)}
          </b>{" "}
          партиди имат обект с известно място. Точките са приблизителни:
          центърът на населеното място или общината.
        </p>
      </div>
    </div>
  );
}

function chip(on: boolean): string {
  return `inline-flex items-center gap-1.5 rounded-full border-[1.5px] px-2.5 py-1 text-[13px] font-semibold ${
    on
      ? "border-ink bg-ink text-white"
      : "border-limestone bg-raised text-ink hover:border-stone"
  }`;
}

/** Приглушава основата, за да изпъкнат флагчетата; надписите на български. */
function styleBasemap(map: MlMap) {
  for (const l of map.getStyle().layers) {
    const hide =
      /^(road|highway|tunnel|bridge|aeroway|poi)/.test(l.id) ||
      l.id.includes("shield") ||
      l.id.includes("poi");
    if (hide) {
      map.setLayoutProperty(l.id, "visibility", "none");
      continue;
    }
    if (l.type === "symbol" && l.layout && "text-field" in l.layout)
      map.setLayoutProperty(l.id, "text-field", [
        "coalesce",
        ["get", "name:bg"],
        ["get", "name"],
      ]);
  }
  if (map.getLayer("background"))
    map.setPaintProperty("background", "background-color", "#f1f3ee");
}

function addLayers(map: MlMap) {
  const kindColor = [
    "match",
    ["get", "k"],
    ...Object.entries(KIND_COLORS).flat(),
    DEFAULT_KIND_COLOR,
  ] as unknown as string;
  map.addLayer({
    id: "cl",
    type: "circle",
    source: "pts",
    filter: ["has", "point_count"],
    paint: {
      "circle-color": "#fff",
      "circle-radius": ["step", ["get", "point_count"], 15, 10, 19, 30, 25],
      "circle-stroke-width": 4,
      "circle-stroke-color": [
        "match",
        ["get", "maxSev"],
        3,
        SEV_COLORS[3]!,
        2,
        SEV_COLORS[2]!,
        SEV_COLORS[1]!,
      ],
    },
  });
  map.addLayer({
    id: "cl-n",
    type: "symbol",
    source: "pts",
    filter: ["has", "point_count"],
    layout: {
      "text-field": ["get", "point_count_abbreviated"],
      "text-font": ["Noto Sans Bold"],
      "text-size": 13,
    },
    paint: { "text-color": "#15212b" },
  });
  map.addLayer({
    id: "sel",
    type: "circle",
    source: "pts",
    filter: ["==", ["get", "i"], -1],
    paint: {
      "circle-radius": 16,
      "circle-color": "rgba(11,110,105,.15)",
      "circle-stroke-color": "#0b6e69",
      "circle-stroke-width": 2,
    },
  });
  map.addLayer({
    id: "dot",
    type: "circle",
    source: "pts",
    filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "sev"], 0]],
    paint: {
      "circle-radius": 5,
      "circle-color": kindColor,
      "circle-stroke-width": 2,
      "circle-stroke-color": "#fff",
    },
  });
  map.addLayer({
    id: "pin",
    type: "symbol",
    source: "pts",
    filter: ["all", ["!", ["has", "point_count"]], [">", ["get", "sev"], 0]],
    layout: {
      "icon-image": [
        "concat",
        "f",
        ["to-string", ["get", "sev"]],
        ["get", "k"],
      ],
      "icon-anchor": "bottom-left",
      "icon-offset": [-6, 2],
      "icon-allow-overlap": true,
      "symbol-sort-key": ["get", "sev"],
    },
  });
}
