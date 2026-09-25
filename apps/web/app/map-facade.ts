/**
 * Статичната карта преди MapLibre: точките на партидите като SVG, рендирани
 * на сървъра. Показва се веднага и без JavaScript; истинската карта се
 * зарежда чак при първо взаимодействие (map-app.tsx). Така 1,5 MB MapLibre
 * и плочките не тежат на първото зареждане, особено на телефон.
 *
 * Всеки цвят е един `<path>` от отсечки с нулева дължина („M x y h0") със
 * заоблени краища - най-компактният начин за хиляда точки в HTML-а.
 */
import {
  BG_BOUNDS,
  DEFAULT_KIND_COLOR,
  KIND_COLORS,
  SEV_COLORS,
} from "./map-style";

export interface FacadePath {
  color: string;
  /** флагнатите партиди са по-едри и с бял пръстен, като на картата */
  flagged: boolean;
  d: string;
}

export const FACADE_W = 1000;

const [[WEST, SOUTH], [EAST, NORTH]] = BG_BOUNDS;
const MID_LAT = ((SOUTH + NORTH) / 2) * (Math.PI / 180);
/** пиксели на градус: равноъгълна проекция, свита по ширина за географската ширина */
const KX = FACADE_W / (EAST - WEST);
const KY = KX / Math.cos(MID_LAT);
export const FACADE_H = Math.round((NORTH - SOUTH) * KY);

export function project(lon: number, lat: number): [number, number] {
  return [Math.round((lon - WEST) * KX), Math.round((NORTH - lat) * KY)];
}

/** Точките, групирани по цвят: първо без индикатор, флагнатите отгоре. */
export function facadePaths(
  points: Array<{ lon: number; lat: number; kind: string; sev: number }>,
): FacadePath[] {
  const groups = new Map<
    string,
    { sev: number; color: string; parts: string[] }
  >();
  for (const p of points) {
    if (p.lon < WEST || p.lon > EAST || p.lat < SOUTH || p.lat > NORTH)
      continue;
    const sev = Math.max(0, Math.min(3, p.sev));
    const color = sev
      ? SEV_COLORS[sev]!
      : (KIND_COLORS[p.kind] ?? DEFAULT_KIND_COLOR);
    const key = `${sev}${color}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { sev, color, parts: [] }));
    const [x, y] = project(p.lon, p.lat);
    g.parts.push(`M${x} ${y}h0`);
  }
  // по тежест: без индикатор отдолу, високата тежест най-отгоре
  return [...groups.values()]
    .sort((a, b) => a.sev - b.sev)
    .map((g) => ({ color: g.color, flagged: g.sev > 0, d: g.parts.join("") }));
}
