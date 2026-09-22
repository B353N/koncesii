import { Link } from "react-router";
import type { Route } from "./+types/blog-post";
import { Breadcrumbs, type Crumb } from "../components";
import { findPost, POSTS, postMeta } from "../blog/posts";
import { loadPostData } from "../blog/posts.server";
import { breadcrumbJsonLd, jsonLdScript } from "../jsonLd";
import { getSummary } from "../queries.server";
import { absUrl, clampDescription, ogDescriptors, pageTitle } from "../seo";

/** /blog/:slug - един анализ. Числата се четат от базата при рендиране. */

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: pageTitle("Анализ") }];
  const { post } = loaderData;
  const description = clampDescription(post.lead);
  const url = absUrl(`/blog/${post.slug}`);
  return [
    { title: pageTitle(post.title) },
    { name: "description", content: description },
    ...ogDescriptors({
      title: post.title,
      description,
      url,
      type: "article",
    }),
    { tagName: "link" as const, rel: "canonical", href: url },
  ];
}

export function loader({ params }: Route.LoaderArgs) {
  const post = findPost(params.slug);
  if (!post) throw new Response("Not Found", { status: 404 });
  return {
    post: postMeta(post),
    data: loadPostData(post.slug),
    dataDate: getSummary()?.data_date ?? null,
    others: POSTS.filter((p) => p.slug !== post.slug)
      .slice(0, 3)
      .map(postMeta),
  };
}

export default function BlogPost({ loaderData }: Route.ComponentProps) {
  const { post, data, dataDate, others } = loaderData;
  const entry = findPost(post.slug);
  if (!entry) return null;
  // Компонентът се извиква като функция: няма hook-ове, а типът на
  // данните е различен за всеки анализ.
  const renderBody = entry.Body as (d: unknown) => React.ReactElement;
  const crumbs: Crumb[] = [
    { label: "Начало", to: "/" },
    { label: "Анализи", to: "/blog" },
    { label: post.title },
  ];

  return (
    <>
      <Breadcrumbs items={crumbs} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript([
          breadcrumbJsonLd(crumbs),
          {
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            headline: post.title,
            description: post.lead,
            datePublished: post.published,
            ...(dataDate ? { dateModified: dataDate } : {}),
            url: absUrl(`/blog/${post.slug}`),
            inLanguage: "bg",
            isPartOf: { "@type": "Blog", url: absUrl("/blog") },
            publisher: { "@id": "https://koncesii.com/#organization" },
          },
        ])}
      />

      <article className="prose-koncesii mx-auto max-w-[72ch] pt-6 pb-8">
        <h1 className="font-display text-3xl leading-tight font-bold text-balance">
          {post.title}
        </h1>
        <p className="mt-2 text-[17px] text-stone">{post.lead}</p>
        <p className="mt-2 font-mono text-xs text-stone">
          <time dateTime={post.published}>{post.published}</time>
          {dataDate && <> · данни към {dataDate}</>}
        </p>
        <div className="mt-6">{renderBody(data)}</div>
      </article>

      <aside className="mx-auto max-w-[72ch] border-t border-limestone pt-4 pb-8">
        <h2 className="font-display text-base font-bold">Още анализи</h2>
        <ul className="mt-1.5 text-[14px]">
          {others.map((p) => (
            <li key={p.slug} className="border-t border-limestone py-2">
              <Link
                to={`/blog/${p.slug}`}
                className="text-water underline decoration-1 underline-offset-2"
              >
                {p.title}
              </Link>
            </li>
          ))}
        </ul>
      </aside>
    </>
  );
}
