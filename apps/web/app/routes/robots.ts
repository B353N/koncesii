/**
 * robots.txt: всичко HTML е разрешено. Машинните изгледи (JSON на
 * партида, .data заявките на React Router, търсенето с безкрайни ?q=)
 * не се обхождат - иначе изяждат crawl budget-а на новия домейн, а
 * страниците за хора остават "открити, но необходени".
 */
export function loader() {
  return new Response(
    [
      "User-agent: *",
      "Allow: /",
      "Disallow: /concessions/*/json",
      "Disallow: /*.data$",
      "Disallow: /search",
      "",
      "Sitemap: https://koncesii.com/sitemap.xml",
      "",
    ].join("\n"),
    { headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
}
