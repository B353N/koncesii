import { Link } from "react-router";
import type { Route } from "./+types/blog";
import { Breadcrumbs, PageTitle, type Crumb } from "../components";
import { POSTS, postMeta } from "../blog/posts";
import { breadcrumbJsonLd, jsonLdScript } from "../jsonLd";
import { absUrl, ogDescriptors, pageTitle } from "../seo";

/** /blog - индекс на анализите върху данните. */

const DESCRIPTION =
  "Анализи върху данните от регистрите на концесиите: какви са сроковете, какви възнаграждения са вписани и какво липсва. Всяко число е от базата и води до партидата в източника.";

export function meta({}: Route.MetaArgs) {
  return [
    { title: pageTitle("Анализи върху данните за концесиите") },
    { name: "description", content: DESCRIPTION },
    ...ogDescriptors({
      title: "Анализи върху данните за концесиите",
      description: DESCRIPTION,
      url: absUrl("/blog"),
    }),
    { tagName: "link" as const, rel: "canonical", href: absUrl("/blog") },
  ];
}

export function loader({}: Route.LoaderArgs) {
  return { posts: POSTS.map(postMeta) };
}

export default function Blog({ loaderData }: Route.ComponentProps) {
  const { posts } = loaderData;
  const crumbs: Crumb[] = [{ label: "Начало", to: "/" }, { label: "Анализи" }];
  return (
    <>
      <Breadcrumbs items={crumbs} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript([
          breadcrumbJsonLd(crumbs),
          {
            "@context": "https://schema.org",
            "@type": "Blog",
            name: "Анализи върху данните за концесиите",
            url: absUrl("/blog"),
            inLanguage: "bg",
            blogPost: posts.map((p) => ({
              "@type": "BlogPosting",
              headline: p.title,
              description: p.lead,
              datePublished: p.published,
              url: absUrl(`/blog/${p.slug}`),
            })),
          },
        ])}
      />
      <PageTitle
        title="Анализи"
        count={`${posts.length} текста върху данните в регистрите`}
      />
      <p className="mt-3 max-w-[70ch] text-[15px] leading-relaxed text-ink/90">
        Числата в тези текстове идват от заявка към базата при отваряне на
        страницата, не са преписани на ръка: така не остаряват след поредното
        снемане и не могат да се разминат с партидите, към които сочат.
      </p>
      <ul className="mt-6">
        {posts.map((p) => (
          <li key={p.slug} className="border-t border-limestone py-4">
            <Link
              to={`/blog/${p.slug}`}
              className="font-display text-lg font-bold text-water no-underline hover:underline"
            >
              {p.title}
            </Link>
            <p className="mt-0.5 max-w-[70ch] text-[14.5px] text-ink/85">
              {p.lead}
            </p>
            <time
              dateTime={p.published}
              className="mt-1 block font-mono text-xs text-stone"
            >
              {p.published}
            </time>
          </li>
        ))}
      </ul>
    </>
  );
}
