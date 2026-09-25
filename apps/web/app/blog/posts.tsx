import { Link } from "react-router";
import { ConcessionsTable } from "../components";
import { fmtEur, fmtMonths } from "../format";
import { kindHref } from "../concessions-list";
import type {
  CompletenessStats,
  ConcessionRow,
  KindStats,
  TermBand,
} from "../queries.server";
import { flagHref, grantorHref, PATHS } from "../paths";

/**
 * Анализите на КОНЦЕСИИ.
 *
 * Всяко число в текста идва от заявка към базата при рендиране, а не е
 * преписано на ръка: така анализът не остарява след поредното снемане и
 * не може да се разминава с партидите, към които сочи. Езикът е на
 * фактите - „N от M партиди нямат вписано възнаграждение", не
 * „скандално малко". Оценката е на читателя.
 */

export interface PostMeta {
  slug: string;
  title: string;
  /** Подзаглавие: какво отговаря текстът, с едно изречение. */
  lead: string;
  /** Дата на публикуване (не се мени при обновяване на данните). */
  published: string;
}

export interface Post extends PostMeta {
  Body: (data: never) => React.ReactElement;
}

/** Число в текста: винаги от базата, винаги с табулярни цифри. */
function N({ children }: { children: React.ReactNode }) {
  return <b className="font-mono font-medium tabular-nums">{children}</b>;
}

function Figure({
  caption,
  children,
}: {
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <figure className="my-5">
      {children}
      <figcaption className="mt-1 text-[13px] text-stone">{caption}</figcaption>
    </figure>
  );
}

function Bars({
  rows,
  unit,
}: {
  rows: Array<{ label: string; value: number; href?: string }>;
  unit?: string;
}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <table className="w-full border-collapse text-[13.5px]">
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className="border-t border-limestone">
            <td className="w-[45%] py-1.5 pr-3">
              {r.href ? (
                <Link
                  to={r.href}
                  className="text-water underline decoration-1 underline-offset-2"
                >
                  {r.label}
                </Link>
              ) : (
                r.label
              )}
            </td>
            <td className="py-1.5">
              <span
                className="inline-block h-3 bg-water/70 align-middle"
                style={{ width: `${Math.round((r.value / max) * 100)}%` }}
              />
            </td>
            <td className="w-[15%] py-1.5 pl-2 text-right font-mono tabular-nums">
              {r.value.toLocaleString("bg-BG")}
              {unit ? ` ${unit}` : ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const pct = (part: number, whole: number) =>
  whole === 0 ? "0%" : `${Math.round((part / whole) * 100)}%`;

// ─────────────────────────────────────────────────────────────────────
// 1. Какво липсва в регистрите
// ─────────────────────────────────────────────────────────────────────

export interface MissingDataData {
  stats: CompletenessStats | null;
  dams: KindStats;
  beaches: KindStats;
}

const missingData = {
  slug: "kakvo-lipsva-v-registrite",
  title: "Какво липсва в регистрите на концесиите",
  lead: "Публичните регистри съдържат всички партиди, но не и всички полета. Ето кои и колко.",
  published: "2026-09-22",
  Body: ({ stats, dams, beaches }: MissingDataData) => {
    if (!stats) return <p>Данните се подготвят.</p>;
    return (
      <>
        <p>
          Национален концесионен регистър и общинските регистри на data.egov.bg
          заедно описват <N>{stats.total}</N> концесии. Това е пълният списък на
          сделките. Не е пълен списъкът на условията по тях.
        </p>
        <Figure caption="Колко партиди носят съответното поле. Източник: НКР и data.egov.bg, данни към датата на последното снемане.">
          <Bars
            rows={[
              {
                label: "име на концесионер",
                value: stats.with_concessionaire,
              },
              { label: "срок", value: stats.with_term },
              { label: "годишно възнаграждение", value: stats.with_payment },
              { label: "стойност на концесията", value: stats.with_value },
            ]}
            unit={`от ${stats.total}`}
          />
        </Figure>
        <p>
          Годишното възнаграждение - числото, което казва срещу какво е отдаден
          обектът - присъства при <N>{stats.with_payment}</N> партиди, или{" "}
          {pct(stats.with_payment, stats.total)} от всички. Стойността на
          концесията, спрямо която това възнаграждение се съотнася, е вписана
          при <N>{stats.with_value}</N>.
        </p>
        <p>
          Затова и най-честият индикатор на сайта не е за прекалено ниско
          плащане, а за липсващо:{" "}
          <Link to={flagHref("MISSING_MONEY")}>MISSING_MONEY</Link> се отнася за
          партиди, в които не е вписано нито еднократно, нито годишно
          възнаграждение. Това не твърди, че плащане няма - твърди, че в
          регистъра го няма.
        </p>
        <h2>Разликата между видовете обекти</h2>
        <p>
          Непълнотата не е равномерна. При{" "}
          <Link to={kindHref("dam")}>язовирите</Link> възнаграждение е вписано
          при <N>{dams.with_payment}</N> от <N>{dams.total}</N> партиди. При{" "}
          <Link to={kindHref("beach")}>морските плажове</Link> - при{" "}
          <N>{beaches.with_payment}</N> от <N>{beaches.total}</N>.
        </p>
        <p>
          Причината е в източника: плажовете и находищата се водят от централни
          органи и голяма част от партидите им идват от стария регистър, където
          полетата на формуляра не са попълвани. Общинските язовири са вписвани
          по-късно и по-пълно.
        </p>
        <h2>Какво правим с липсващото</h2>
        <p>
          Не го попълваме. Липсващата стойност остава липсваща, отбелязана с
          флаг за качество до всяко поле, а суровият текст от регистъра стои на
          страницата на партидата дословно - включително когато е „Няма въведени
          данни" или две противоречащи си числа.{" "}
          <Link to={PATHS.methodology}>Методологията</Link> описва всяко
          правило.
        </p>
        <p>
          Пълнотата е измерима и ще се мени с всяко снемане.{" "}
          <Link to={PATHS.changes}>Страницата с промените</Link> показва кога и
          какво се е променило.
        </p>
      </>
    );
  },
};

// ─────────────────────────────────────────────────────────────────────
// 2. Язовирите под концесия
// ─────────────────────────────────────────────────────────────────────

export interface DamsData {
  stats: KindStats;
  terms: TermBand;
  grantors: Array<{ slug: string; name: string; n: number }>;
  top: ConcessionRow[];
}

const dams = {
  slug: "yazovirite-pod-koncesiya",
  title: "Язовирите под концесия: кой ги стопанисва и за колко време",
  lead: "Язовирите са най-многобройният вид обект в регистрите след находищата. Ето какво казват данните за тях.",
  published: "2026-09-22",
  Body: ({ stats, terms, grantors, top }: DamsData) => (
    <>
      <p>
        В регистрите има <N>{stats.total}</N> концесии върху язовири, водоеми и
        микроязовири, отдадени от <N>{stats.grantors}</N> концедента - предимно
        общини. Пълният списък е на{" "}
        <Link to={kindHref("dam")}>страницата за язовири</Link>.
      </p>
      <Figure caption="Общини с най-много концесии за язовири. Всяка води към партидите на съответния концедент.">
        <Bars
          rows={grantors.map((g) => ({
            label: g.name,
            value: g.n,
            href: grantorHref(g.slug),
          }))}
        />
      </Figure>
      <h2>Срокове</h2>
      <p>
        Срок е вписан при <N>{terms.with_term}</N> от партидите. От тях{" "}
        <N>{terms.over_25y}</N> са за 25 или повече години, а{" "}
        <N>{terms.over_35y}</N> - за 35 или повече. Най-дългият е{" "}
        <N>{fmtMonths(terms.max_months)}</N>.
      </p>
      <p>
        Дългият срок сам по себе си не е нередност: язовирната стена изисква
        поддръжка, която не се изплаща за три години. Той обаче заключва
        условията, договорени в началото - затова{" "}
        <Link to={flagHref("LONG_TERM")}>LONG_TERM</Link> отбелязва партидите
        над прага, а <Link to={flagHref("NO_INDEXATION")}>NO_INDEXATION</Link> -
        тези, в които при дълъг срок липсва клауза за индексация.
      </p>
      <h2>Възнаграждения</h2>
      <p>
        Годишно възнаграждение е вписано при <N>{stats.with_payment}</N> от{" "}
        <N>{stats.total}</N> партиди
        {stats.annual_sum != null && (
          <>
            , а сборът им е <N>{fmtEur(stats.annual_sum)}</N> годишно
          </>
        )}
        . Ето най-високите от тях.
      </p>
      <ConcessionsTable rows={top as ConcessionRow[]} />
      <p>
        За сравнение: това са суми от порядъка на няколко хиляди евро годишно за
        обект, който се стопанисва десетилетия. Дали са адекватни, зависи от
        състоянието на съоръжението и поетите задължения - неща, които
        регистърът не съдържа. Тук стои само това, което е вписано, с връзка към
        партидата в източника.
      </p>
    </>
  ),
};

// ─────────────────────────────────────────────────────────────────────
// 3. Дългите срокове
// ─────────────────────────────────────────────────────────────────────

export interface LongTermsData {
  all: TermBand;
  longest: ConcessionRow[];
}

const longTerms = {
  slug: "dulgite-srokove",
  title: "Концесиите с най-дълги срокове",
  lead: "Колко са сделките, които заключват публична собственост за поколение напред, и кои са те.",
  published: "2026-09-22",
  Body: ({ all, longest }: LongTermsData) => (
    <>
      <p>
        Срок е вписан при <N>{all.with_term}</N> партиди. От тях{" "}
        <N>{all.over_25y}</N> са за 25 години или повече, а{" "}
        <N>{all.over_35y}</N> - за 35 или повече. Най-дългият вписан срок е{" "}
        <N>{fmtMonths(all.max_months)}</N>.
      </p>
      <p>
        Прагът от 25 години не е измислен от нас: около него минава границата
        между концесия, която се изплаща в рамките на един инвестиционен цикъл,
        и такава, която обвързва следващия. Пълното правило и прагът са в{" "}
        <Link to={PATHS.methodology}>методологията</Link>, а всички засегнати
        партиди - на{" "}
        <Link to={flagHref("LONG_TERM")}>страницата с индикатори</Link>.
      </p>
      <Figure caption="Десетте най-дълги срока в регистрите. Числата са както са вписани в източника.">
        <ConcessionsTable rows={longest as ConcessionRow[]} />
      </Figure>
      <p>
        Част от тези стойности изглеждат невъзможни - срокове над сто години. Не
        са грешка на сайта: така са вписани в регистъра, вероятно защото полето
        е попълнено в месеци, а в него е записана стойност в години, или
        обратно. Не ги поправяме; показваме ги заедно със суровия текст, от
        който са парснати, и с флаг за качеството. Ако регистърът бъде
        коригиран, следващото снемане ще го отрази и партидата ще се появи в{" "}
        <Link to={PATHS.changes}>промените</Link>.
      </p>
    </>
  ),
};

// ─────────────────────────────────────────────────────────────────────
// 4. Морските плажове
// ─────────────────────────────────────────────────────────────────────

export interface BeachesData {
  stats: KindStats;
  terms: TermBand;
  top: ConcessionRow[];
  grantors: Array<{ slug: string; name: string; n: number }>;
}

const beaches = {
  slug: "morskite-plazhove",
  title: "Морските плажове: 15 до 20 години напред",
  lead: "Какво съдържат и какво не съдържат партидите за концесиите по Черноморието.",
  published: "2026-09-22",
  Body: ({ stats, terms, top, grantors }: BeachesData) => (
    <>
      <p>
        В регистрите има <N>{stats.total}</N> концесии за морски плажове,
        отдадени от <N>{stats.grantors}</N> концедента
        {grantors[0] && (
          <>
            , най-много от{" "}
            <Link to={grantorHref(grantors[0].slug)}>{grantors[0].name}</Link> (
            <N>{grantors[0].n}</N>)
          </>
        )}
        . Пълният списък е на{" "}
        <Link to={kindHref("beach")}>страницата за плажове</Link>.
      </p>
      <h2>Сроковете са предвидими, сумите - не</h2>
      <p>
        Срок е вписан при <N>{terms.with_term}</N> партиди и обичайно е 15 или
        20 години. Годишно възнаграждение обаче е вписано само при{" "}
        <N>{stats.with_payment}</N> от <N>{stats.total}</N> партиди
        {stats.annual_sum != null && (
          <>
            {" "}
            и сборът на вписаните е <N>{fmtEur(stats.annual_sum)}</N>
          </>
        )}
        .
      </p>
      <p>
        Това е най-съществената празнина в тази категория: за по-голямата част
        от плажовете регистърът не казва срещу какво са отдадени. Партидите на
        по-старите концесии идват от архива на регистъра преди 2021 г., където
        финансовите полета не са били попълвани.
      </p>
      <Figure caption="Партидите за плажове с вписано годишно възнаграждение, подредени по размер.">
        <ConcessionsTable rows={top as ConcessionRow[]} />
      </Figure>
      <p>
        Числата в таблицата са годишни суми в евро, превалутирани от лева по
        фиксирания курс 1,95583 лв. за 1 €, когато оригиналът е в лева.
        Оригиналният запис стои на страницата на всяка партида, заедно с връзка
        към източника.
      </p>
    </>
  ),
};

/** Хронологично, най-новото първо. */
export const POSTS = [missingData, dams, longTerms, beaches] as const;

export type AnyPost = (typeof POSTS)[number];

export function findPost(slug: string): AnyPost | null {
  return POSTS.find((p) => p.slug === slug) ?? null;
}

export function postMeta(p: AnyPost): PostMeta {
  return {
    slug: p.slug,
    title: p.title,
    lead: p.lead,
    published: p.published,
  };
}
