import { Form } from "react-router";
import type { Route } from "./+types/search";
import { ConcessionsTable, DataPending, PageTitle } from "../components";
import { getSummary, listConcessions } from "../queries.server";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Търсене — КОНЦЕСИИ" },
    {
      name: "description",
      content:
        "Търсене по обект, компания, община или номер на партида във всички концесии в България.",
    },
  ];
}

export function loader({ request }: Route.LoaderArgs) {
  const q = new URL(request.url).searchParams.get("q")?.trim() || null;
  const { rows, total } = q
    ? listConcessions({ q, limit: 100 })
    : { rows: [], total: 0 };
  return { q, rows, total, hasDb: getSummary() !== null };
}

export default function Search({ loaderData }: Route.ComponentProps) {
  const { q, rows, total, hasDb } = loaderData;
  if (!hasDb) return <DataPending />;

  return (
    <>
      <PageTitle title="Търсене" />
      <Form method="get" className="mt-4 flex max-w-xl">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          aria-label="Търсене"
          placeholder="Обект, компания, община или номер на партида…"
          className="flex-1 rounded-l-[2px] border-[1.5px] border-r-0 border-ink bg-raised px-3.5 py-2.5 text-[15px] placeholder:text-stone"
        />
        <button
          type="submit"
          className="rounded-r-[2px] border-[1.5px] border-water bg-water px-5 text-sm font-semibold text-white hover:border-water-br hover:bg-water-br"
        >
          Търси
        </button>
      </Form>
      {q && (
        <p className="mt-4 text-sm text-stone">
          {total} {total === 1 ? "резултат" : "резултата"} за „{q}“
          {total > rows.length && ` (показани първите ${rows.length})`}
        </p>
      )}
      {rows.length > 0 && <ConcessionsTable rows={rows} />}
      {q && rows.length === 0 && (
        <p className="mt-6 text-stone">
          Нищо не е намерено. Опитайте с част от името на обекта, концесионера
          или общината, или с номер на партида (напр. O-000123).
        </p>
      )}
    </>
  );
}
