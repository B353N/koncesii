import { Link, redirect } from "react-router";
import type { Route } from "./+types/document-text";
import { Breadcrumbs, Prov, regNumLabel, type Crumb } from "../components";
import {
  FACT_LABELS,
  FACT_OUTCOMES,
  fmtDocumentMeta,
  fmtFact,
} from "../format";
import { getDocumentText, resolveConcession } from "../queries.server";
import { concessionHref } from "../slug";
import { absUrl, clampDescription, pageTitle, shortenTitle } from "../seo";
import { breadcrumbJsonLd, jsonLdScript } from "../jsonLd";

/**
 * /concessions/:slug/documents/:key — текстът на прикачен документ,
 * по страници, с метода на всяка (текстов слой или OCR) и линк към
 * оригинала в регистъра. Оригиналът е меродавен; текстът е за търсене и
 * четене (docs/document-extraction.md).
 */

export function loader({ params }: Route.LoaderArgs) {
  const hit = resolveConcession(params.slug);
  if (!hit) throw new Response("Not Found", { status: 404 });
  if (hit.slug !== params.slug) {
    throw redirect(
      `${concessionHref(hit.slug)}/documents/${encodeURIComponent(params.key)}`,
      301,
    );
  }
  const doc = getDocumentText(hit.reg_num, params.key);
  if (!doc || doc.pages.length === 0) {
    throw new Response("Not Found", { status: 404 });
  }
  return { doc };
}

function docTitle(title: string | null): string {
  return title?.trim() || "Документ";
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: pageTitle("Документът не е намерен") }];
  const { doc } = loaderData;
  const title = `${docTitle(doc.document.title)} — ${shortenTitle(doc.concession.title, 70)}`;
  const firstText = doc.pages
    .map((p) => p.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const description = clampDescription(
    `Пълният текст на документа по концесия ${regNumLabel(doc.concession.reg_num)} (${doc.concession.title}), по страници, с линк към оригинала в НКР. ${firstText}`,
    300,
  );
  const url = absUrl(
    `${concessionHref(doc.concession.slug)}/documents/${doc.document.key}`,
  );
  return [
    { title: pageTitle(title) },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: url },
    { property: "og:type", content: "article" },
    { tagName: "link" as const, rel: "canonical", href: url },
  ];
}

export default function DocumentText({ loaderData }: Route.ComponentProps) {
  const { doc } = loaderData;
  const concessionUrl = concessionHref(doc.concession.slug);
  const crumbs: Crumb[] = [
    { label: "Начало", to: "/" },
    { label: "Концесии", to: "/concessions" },
    { label: regNumLabel(doc.concession.reg_num), to: concessionUrl },
    { label: docTitle(doc.document.title) },
  ];
  const ocr = doc.pages.some((p) => p.method === "ocr");
  const meta = fmtDocumentMeta(doc.document);

  return (
    <>
      <Breadcrumbs items={crumbs} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript([breadcrumbJsonLd(crumbs)])}
      />
      <header className="mt-4 mb-5">
        <div className="mb-1 font-mono text-xs uppercase tracking-wider text-stone">
          Документ по партида {doc.concession.reg_num}
        </div>
        <h1 className="font-display text-2xl leading-tight font-bold text-balance">
          {docTitle(doc.document.title)}
        </h1>
        <p className="mt-1.5 text-sm text-ink/85">
          Към концесия:{" "}
          <Link
            to={concessionUrl}
            className="font-semibold text-water underline decoration-1 underline-offset-2"
          >
            {doc.concession.title}
          </Link>
        </p>
        {meta && <p className="mt-1 text-xs text-stone">{meta}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2.5 text-[13px] text-stone">
          <span>Оригиналът е меродавен:</span>
          <Prov href={doc.document.url}>Оригиналът в НКР</Prov>
        </div>
        {ocr && (
          <p className="mt-3 max-w-[72ch] rounded-[2px] border border-limestone bg-raised px-3 py-2 text-[13px] text-stone">
            Страниците, отбелязани с OCR, са сканирани изображения. Текстът им е
            разпознат автоматично и може да съдържа грешки в отделни букви и
            цифри — при съмнение сверете с оригинала.
          </p>
        )}
      </header>

      {doc.facts.length > 0 && (
        <section className="mb-6">
          <h2 className="font-display text-base font-bold">Намерени клаузи</h2>
          <ul className="mt-2 grid gap-2">
            {doc.facts.map((f, i) => (
              <li key={i} className="text-[13.5px]">
                <a
                  href={`#str-${f.page}`}
                  className="text-water underline underline-offset-2"
                >
                  стр. {f.page}
                </a>{" "}
                · {FACT_LABELS[f.field] ?? f.field}:{" "}
                <b className="font-mono font-medium tabular-nums">
                  {fmtFact(f)}
                </b>{" "}
                <span className="text-xs text-stone">
                  ({FACT_OUTCOMES[f.outcome] ?? f.outcome})
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Текстът на документа">
        {doc.pages.map((p) => (
          <article
            key={p.page}
            id={`str-${p.page}`}
            className="scroll-mt-4 border-t border-limestone pt-3 pb-5"
          >
            <h2 className="mb-2 font-mono text-xs uppercase tracking-wider text-stone">
              Страница {p.page}
              {p.method === "ocr" ? " · OCR" : ""}
              {p.method === "needs_ocr"
                ? " · сканирана, без разпознат текст"
                : ""}
            </h2>
            {p.text.trim() ? (
              <div className="max-w-[80ch] text-[14.5px] leading-relaxed whitespace-pre-wrap break-words">
                {p.text.trim()}
              </div>
            ) : (
              <p className="text-sm text-stone">
                Страницата няма текст (празна или изображение без разпознат
                текст) — вижте оригинала.
              </p>
            )}
          </article>
        ))}
      </section>

      <div className="mt-2 flex flex-wrap items-center gap-2.5 border-t-[1.5px] border-ink pt-3.5 pb-8 text-[13px] text-stone">
        <span>Произход:</span>
        <Prov href={doc.document.url}>Оригиналът в НКР</Prov>
        <Link
          to={concessionUrl}
          className="text-water underline underline-offset-2"
        >
          ← към концесията
        </Link>
      </div>
    </>
  );
}
