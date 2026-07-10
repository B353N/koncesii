export function loader() {
  return new Response(
    [
      "User-agent: *",
      "Allow: /",
      "Sitemap: https://koncesii.com/sitemap.xml",
      "",
    ].join("\n"),
    { headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
}
