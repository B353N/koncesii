import type { Route } from "./+types/company-detail";
import { ConcessionsTable, PageTitle } from "../components";
import { getCompany } from "../queries.server";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `${loaderData?.company.name ?? "Компания"} — КОНЦЕСИИ` }];
}

export function loader({ params }: Route.LoaderArgs) {
  const result = getCompany(params.eik);
  if (!result) throw new Response("Not Found", { status: 404 });
  return result;
}

export default function CompanyDetail({ loaderData }: Route.ComponentProps) {
  const { company, concessions } = loaderData;
  return (
    <>
      <PageTitle
        title={company.name}
        count={
          <>
            концесионер · <span className="font-mono">ЕИК {company.eik}</span> ·{" "}
            {concessions.length}{" "}
            {concessions.length === 1 ? "концесия" : "концесии"}
            {company.address && <> · {company.address}</>}
          </>
        }
      />
      <div className="mt-3">
        <ConcessionsTable rows={concessions} />
      </div>
    </>
  );
}
