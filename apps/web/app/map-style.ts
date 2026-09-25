/**
 * Цветовете на картата (docs/design.md, v2). Флагчето носи тежестта на
 * индикатора, точката в основата му носи вида обект.
 */
export const KIND_COLORS: Record<string, string> = {
  mining: "#5b4bb7",
  beach: "#1f86c8",
  quarry: "#9a7446",
  mineral_water: "#16a291",
  dam: "#2f6db0",
  port: "#34495e",
  infrastructure: "#6b7a86",
  property: "#b0568a",
  service: "#4f8a3c",
  other: "#7a8791",
};
export const DEFAULT_KIND_COLOR = "#7a8791";

/** 1 ниска, 2 средна, 3 висока тежест (SEVERITY_RANK). */
export const SEV_COLORS: Record<number, string> = {
  1: "#8795a1",
  2: "#e39a14",
  3: "#d9442a",
};

/** Етикет на тежестта за текст до флагче. */
export const SEV_LABELS: Record<number, string> = {
  0: "без индикатор",
  1: "ниска тежест",
  2: "средна тежест",
  3: "висока тежест",
};

/** Векторна основа без ключ: OpenFreeMap (OpenMapTiles, данни от OSM). */
export const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

export const BG_BOUNDS: [[number, number], [number, number]] = [
  [22.2, 41.15],
  [28.75, 44.3],
];
export const MAX_BOUNDS: [[number, number], [number, number]] = [
  [19.5, 39.8],
  [31.5, 45.8],
];
