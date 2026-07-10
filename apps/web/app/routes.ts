import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("concessions", "routes/concessions.tsx"),
  route("concessions.csv", "routes/concessions-csv.ts"),
  route("concessions/:regNum", "routes/concession-detail.tsx"),
  route("concessions/:regNum/json", "routes/concession-json.ts"),
  route("grantors", "routes/grantors.tsx"),
  route("grantors.csv", "routes/grantors-csv.ts"),
  route("grantors/:slug", "routes/grantor-detail.tsx"),
  route("companies", "routes/companies.tsx"),
  route("companies.csv", "routes/companies-csv.ts"),
  route("companies/:eik", "routes/company-detail.tsx"),
  route("flags", "routes/flags.tsx"),
  route("flags.csv", "routes/flags-csv.ts"),
  route("search", "routes/search.tsx"),
  route("methodology", "routes/methodology.tsx"),
  route("robots.txt", "routes/robots.ts"),
  route("sitemap.xml", "routes/sitemap.ts"),
] satisfies RouteConfig;
