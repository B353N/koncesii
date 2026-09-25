import { expect, test } from "vitest";
import { FACADE_H, FACADE_W, facadePaths, project } from "./map-facade";
import { KIND_COLORS, SEV_COLORS } from "./map-style";

test("проекцията слага ъглите на България в ъглите на изгледа", () => {
  expect(project(22.2, 44.3)).toEqual([0, 0]);
  expect(project(28.75, 41.15)).toEqual([FACADE_W, FACADE_H]);
  // Пловдив: в долната половина, малко вляво от средата
  const [x, y] = project(24.75, 42.15);
  expect(x).toBeGreaterThan(300);
  expect(x).toBeLessThan(FACADE_W / 2);
  expect(y).toBeGreaterThan(FACADE_H / 2);
});

test("точките се групират по цвят, флагнатите са отгоре, чуждите се пропускат", () => {
  const paths = facadePaths([
    { lon: 23.3, lat: 42.7, kind: "beach", sev: 0 },
    { lon: 27.9, lat: 43.2, kind: "beach", sev: 0 },
    { lon: 25.0, lat: 42.0, kind: "mining", sev: 3 },
    { lon: 26.0, lat: 43.0, kind: "quarry", sev: 1 },
    { lon: 2.0, lat: 48.0, kind: "beach", sev: 3 }, // Париж, извън обхвата
  ]);
  expect(paths.map((p) => p.color)).toEqual([
    KIND_COLORS["beach"],
    SEV_COLORS[1],
    SEV_COLORS[3],
  ]);
  expect(paths[0]).toMatchObject({ flagged: false });
  expect(paths[0]!.d.match(/M/g)).toHaveLength(2);
  expect(paths[2]).toMatchObject({ flagged: true });
  expect(paths[2]!.d).toMatch(/^M\d+ \d+h0$/);
});
