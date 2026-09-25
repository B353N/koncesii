import type { Route } from "./+types/map";
import { DataPending } from "../components";
import { MapApp } from "../map-app";
import { getSummary, mapPoints } from "../queries.server";
import type { RouteHandle } from "../root";
import { absUrl, ogDescriptors, pageTitle } from "../seo";
import { PATHS } from "../paths";

export const handle: RouteHandle = { fullBleed: true };

export function meta({}: Route.MetaArgs) {
  return [
    { title: pageTitle("Карта на концесиите в България") },
    {
      name: "description",
      content:
        "Концесиите в България върху карта: морски плажове, находища и кариери, с индикаторите на всяка сделка и връзка към партидата ѝ в регистъра.",
    },
    ...ogDescriptors({
      title: "Карта на концесиите в България",
      description:
        "Концесиите в България върху карта: морски плажове, находища и кариери, с индикаторите на всяка сделка и връзка към партидата ѝ в регистъра.",
      url: absUrl(PATHS.map),
    }),
    { tagName: "link", rel: "canonical", href: absUrl(PATHS.map) },
  ];
}

export function loader({}: Route.LoaderArgs) {
  const points = mapPoints();
  const onMap = new Map<string, number>();
  for (const p of points) onMap.set(p.kind, (onMap.get(p.kind) ?? 0) + 1);
  return {
    summary: getSummary(),
    initial: points.slice(0, 40),
    geocoded: points.length,
    mapKinds: [...onMap]
      .map(([kind, n]) => ({ kind, n }))
      .sort((a, b) => b.n - a.n),
  };
}

export default function MapPage({ loaderData }: Route.ComponentProps) {
  const { summary, initial, geocoded, mapKinds } = loaderData;
  if (!summary)
    return (
      <div className="mx-auto max-w-5xl px-5">
        <DataPending />
      </div>
    );

  return (
    <MapApp
      heading={
        <h1 className="font-display text-[25px] leading-[1.2] font-bold tracking-[-0.02em] text-balance">
          Карта на концесиите в България
        </h1>
      }
      intro={
        <p className="text-[14px]">
          Местата са извлечени от полето „Местонахождение" на обявленията в НКР
          и гео-кодирани по центроиди от{" "}
          <a
            href="https://www.geonames.org"
            rel="noopener"
            className="underline"
          >
            GeoNames
          </a>{" "}
          (CC BY 4.0), затова са приблизителни. Данните са и като{" "}
          <a href={PATHS.mapGeojson} className="underline">
            GeoJSON
          </a>
          .
        </p>
      }
      initial={initial}
      kinds={mapKinds}
      geocoded={geocoded}
      total={summary.concessions}
    />
  );
}
