import { Form, Link } from "react-router";
import type { Route } from "./+types/home";
import { DataPending } from "../components";
import { fmtMonths, fmtPercent, KIND_LABELS } from "../format";
import {
  getSummary,
  kindCounts,
  lowestPaymentRatio,
  topByTerm,
} from "../queries.server";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "КОНЦЕСИИ — прозрачност на концесиите в България" },
    {
      name: "description",
      content:
        "Публичен портал за всички концесии в България — язовири, плажове, добив, публична собственост. Всяка сделка е проследима до официалния източник.",
    },
  ];
}

export function loader({}: Route.LoaderArgs) {
  return {
    summary: getSummary(),
    kinds: kindCounts(),
    longest: topByTerm(5),
    lowest: lowestPaymentRatio(5),
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { summary, kinds, longest, lowest } = loaderData;
  if (!summary) return <DataPending />;

  return (
    <>
      <section className="pt-12">
        <h1 className="max-w-[21ch] font-display text-4xl font-bold leading-[1.14] text-balance">
          Публичната собственост, отдадена под концесия —{" "}
          <em className="not-italic text-water">на едно място, до източника</em>
          .
        </h1>
        <p className="mt-4 max-w-[58ch] text-stone">
          Язовири, морски плажове, находища, имоти. Кой ги държи, за колко
          години и срещу какво възнаграждение — от Националния концесионен
          регистър и отворените данни на държавата.
        </p>
        <div className="mt-6 flex flex-wrap gap-x-6 gap-y-1 border-t border-ink border-b border-b-limestone py-2.5 font-mono text-sm tabular-nums">
          <span className="text-stone">
            данни към{" "}
            <b className="font-medium text-ink">{summary.data_date}</b>
          </span>
          <span>
            <b className="font-medium">{summary.concessions}</b>{" "}
            <span className="text-stone">концесии</span>
          </span>
          <span>
            <b className="font-medium">{summary.grantors}</b>{" "}
            <span className="text-stone">концеденти</span>
          </span>
          <span>
            <b className="font-medium">{summary.concessionaires}</b>{" "}
            <span className="text-stone">компании</span>
          </span>
          <span>
            <b className="font-medium">{summary.flagged}</b>{" "}
            <span className="text-stone">с индикатор</span>
          </span>
        </div>
        <Form action="/search" className="mt-6 flex max-w-xl">
          <input
            type="search"
            name="q"
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
      </section>

      <section className="mt-9 grid grid-cols-2 gap-px border border-limestone bg-limestone sm:grid-cols-3 md:grid-cols-4">
        {kinds.map((k) => (
          <Link
            key={k.kind}
            to={`/concessions?kind=${k.kind}`}
            className="bg-raised px-3.5 py-3 no-underline hover:bg-[#f2f4ee]"
          >
            <span className="block font-mono text-[22px] tabular-nums">
              {k.n}
            </span>
            <span className="text-[13px] text-stone">
              {KIND_LABELS[k.kind] ?? k.kind}
            </span>
          </Link>
        ))}
      </section>

      <section className="mt-9 grid gap-8 pb-6 md:grid-cols-2">
        <div>
          <h2 className="font-display text-lg font-bold">Най-дълги срокове</h2>
          <p className="mb-2 text-xs text-stone">
            концесии, подредени по договорен срок
          </p>
          <table className="w-full border-collapse text-[13.5px]">
            <tbody>
              {longest.map((c) => (
                <tr key={c.reg_num} className="border-t border-limestone">
                  <td className="py-2 pr-2">
                    <Link
                      to={`/concessions/${encodeURIComponent(c.reg_num)}`}
                      className="text-water underline decoration-1 underline-offset-2"
                    >
                      {c.title}
                    </Link>
                    <span className="block text-xs text-stone">
                      {c.grantor_name}
                    </span>
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums whitespace-nowrap">
                    {fmtMonths(c.term_months)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h2 className="font-display text-lg font-bold">
            Най-ниски възнаграждения
          </h2>
          <p className="mb-2 text-xs text-stone">
            годишно възнаграждение като % от стойността
          </p>
          <table className="w-full border-collapse text-[13.5px]">
            <tbody>
              {lowest.map((c) => (
                <tr key={c.reg_num} className="border-t border-limestone">
                  <td className="py-2 pr-2">
                    <Link
                      to={`/concessions/${encodeURIComponent(c.reg_num)}`}
                      className="text-water underline decoration-1 underline-offset-2"
                    >
                      {c.title}
                    </Link>
                    <span className="block text-xs text-stone">
                      {c.grantor_name}
                    </span>
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {fmtPercent(c.ratio)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
