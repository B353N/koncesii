import type { Route } from "./+types/grantor-detail";
import { ConcessionsTable, PageTitle } from "../components";
import { getGrantor } from "../queries.server";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `${loaderData?.grantor.name ?? "Концедент"} — КОНЦЕСИИ` }];
}

export function loader({ params }: Route.LoaderArgs) {
  const result = getGrantor(params.slug);
  if (!result) throw new Response("Not Found", { status: 404 });
  return result;
}

export default function GrantorDetail({ loaderData }: Route.ComponentProps) {
  const { grantor, concessions } = loaderData;
  return (
    <>
      <PageTitle
        title={grantor.name}
        count={`концедент · ${concessions.length} ${concessions.length === 1 ? "концесия" : "концесии"}`}
      />
      <div className="mt-3">
        <ConcessionsTable rows={concessions} showGrantor={false} />
      </div>
    </>
  );
}
