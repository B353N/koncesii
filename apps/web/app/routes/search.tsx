import { Form, Link } from "react-router";
import type { Route } from "./+types/search";
import {
  ConcessionsTable,
  DataPending,
  PageTitle,
  regNumLabel,
  Snippet,
} from "../components";
import {
  getSummary,
  listConcessions,
  searchDocuments,
} from "../queries.server";
import { concessionHref } from "../slug";
import { pageTitle } from "../seo";

export function meta({}: Route.MetaArgs) {
  return [
    { title: pageTitle("Търсене") },
    {
      name: "description",
      content:
        "Търсене по обект, компания, община или номер на партида във всички концесии в България — и в пълния текст на договорите и решенията.",
    },
    // резултатите от търсене не се индексират — безкрайни ?q= варианти
    { name: "robots", content: "noindex, follow" },
  ];
}

export function loader({ request }: Route.LoaderArgs) {
  const q = new URL(request.url).searchParams.get("q")?.trim() || null;
  const { rows, total } = q
    ? listConcessions({ q, limit: 100 })
    : { rows: [], total: 0 };
  const docs = q ? searchDocuments(q, 50) : { hits: [], total: 0 };
  return { q, rows, total, docs, hasDb: getSummary() !== null };
}

export default function Search({ loaderData }: Route.ComponentProps) {
  const { q, rows, total, docs, hasDb } = loaderData;
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
          placeholder="Обект, компания, община, номер на партида или текст от договор…"
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
          За „{q}“: {total} {total === 1 ? "концесия" : "концесии"}
          {total > rows.length && ` (показани първите ${rows.length})`}
          {docs.total > 0 &&
            ` · ${docs.total} ${docs.total === 1 ? "страница" : "страници"} в документите`}
        </p>
      )}
      {rows.length > 0 && <ConcessionsTable rows={rows} />}
      {docs.hits.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-lg font-bold">
            В текста на документите
          </h2>
          <p className="mt-1 text-sm text-stone">
            {docs.total} {docs.total === 1 ? "страница" : "страници"} от
            договори и решения
            {docs.total > docs.hits.length &&
              ` (показани първите ${docs.hits.length})`}
            . Текстът е извлечен от прикачените файлове; при сканирани страници
            — разпознат автоматично (OCR).
          </p>
          <ul className="mt-3 grid gap-3">
            {docs.hits.map((h, i) => (
              <li
                key={i}
                className="border-t border-dashed border-limestone pt-3 first:border-t-0 first:pt-0"
              >
                <Link
                  to={`${concessionHref(h.slug)}/documents/${h.document_key}#str-${h.page}`}
                  className="font-semibold text-water underline decoration-1 underline-offset-2"
                >
                  {h.document_title ?? "Документ"}, стр. {h.page}
                </Link>
                {h.method === "ocr" && (
                  <span className="ml-1.5 font-mono text-[11px] text-stone">
                    OCR
                  </span>
                )}
                <span className="block text-xs text-stone">
                  {regNumLabel(h.reg_num)} ·{" "}
                  <Link
                    to={concessionHref(h.slug)}
                    className="text-water underline underline-offset-2"
                  >
                    {h.concession_title}
                  </Link>{" "}
                  ·{" "}
                  <a
                    href={h.document_url}
                    rel="noopener"
                    className="text-water underline underline-offset-2"
                  >
                    оригинал ↗
                  </a>
                </span>
                <p className="mt-1 max-w-[80ch] text-[13.5px] leading-relaxed text-ink/85">
                  <Snippet text={h.snippet} />
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {q && rows.length === 0 && docs.hits.length === 0 && (
        <p className="mt-6 text-stone">
          Нищо не е намерено. Опитайте с част от името на обекта, концесионера
          или общината, с номер на партида (напр. O-000123) или с дума от текста
          на договора.
        </p>
      )}
    </>
  );
}
