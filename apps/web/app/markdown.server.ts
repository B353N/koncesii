import {
  CONCESSION_KIND_LABELS,
  FLAG_DESCRIPTIONS,
  fmtEur,
  fmtMonths,
  KIND_LABELS,
  KIND_PAGE_TITLES,
  SEVERITY_LABELS,
} from "./format";
import {
  changeDates,
  recentlyChanged,
  getCompany,
  getConcession,
  resolveConcession,
  getGrantor,
  getSummary,
  kindCounts,
  listCompanies,
  listConcessions,
  listFlagCodes,
  listFlagged,
  listGrantors,
  type ConcessionRow,
} from "./queries.server";
import { POSTS } from "./blog/posts";
import {
  blogHref,
  companyHref,
  concessionHref,
  flagHref,
  grantorHref,
  PATHS,
} from "./paths";
import { eikOfSlug, kindOfSlug } from "./slug";

/**
 * Markdown за агенти: заявка с Accept: text/markdown получава markdown
 * изглед на същия URL (HTML остава по подразбиране). Рендерира се направо
 * от заявките, не от React дървото — токен-икономично и без дублиране на
 * loader-ите. Непокрит път връща null → нормалният HTML отговор.
 */

const BASE = "https://koncesii.com";
const LIST_LIMIT = 50;

export function wantsMarkdown(request: Request): boolean {
  return /\btext\/markdown\b/i.test(request.headers.get("accept") ?? "");
}

/** Markdown таблична клетка: без | и нови редове. */
function cell(v: string | number | null | undefined): string {
  if (v == null) return "";
  return String(v).replaceAll("|", "\\|").replaceAll(/\s+/gu, " ").trim();
}

function table(
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): string {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
  ].join("\n");
}

function concessionTable(rows: ConcessionRow[]): string {
  return table(
    ["Партида", "Обект", "Концедент", "Концесионер", "Срок", "Годишно (EUR)"],
    rows.map((r) => [
      `[${r.reg_num}](${BASE}${concessionHref(r.slug)})`,
      r.title,
      r.grantor_name,
      r.concessionaire_name,
      fmtMonths(r.term_months),
      r.annual_payment_eur == null ? "—" : fmtEur(r.annual_payment_eur),
    ]),
  );
}

const FOOTER = `\n\n---\nМашинночетими данни: [OpenAPI](${BASE}/openapi.json) · [API каталог](${BASE}/.well-known/api-catalog) · [skill за агенти](${BASE}/.well-known/agent-skills/index.json). Всяко число е проследимо до източника си; индикаторите са аритметични факти, не обвинения ([методология](${BASE}${PATHS.methodology})).\n`;

function mdHome(): string {
  const s = getSummary();
  if (!s) return "# КОНЦЕСИИ\n\nДанните се подготвят.";
  const kinds = kindCounts();
  return (
    `# КОНЦЕСИИ — прозрачност на концесиите в България\n\n` +
    `Данни към ${s.data_date}: **${s.concessions} концесии**, ${s.grantors} концеденти, ` +
    `${s.concessionaires} концесионери, ${s.flagged} с индикатор за риск.\n\n` +
    `## Обекти по вид\n\n` +
    table(
      ["Вид", "Брой"],
      kinds.map((k) => [KIND_LABELS[k.kind] ?? k.kind, k.n]),
    ) +
    `\n\n## Раздели\n\n` +
    `- [Концесии](${BASE}${PATHS.concessions}) — пълният списък ([CSV](${BASE}${PATHS.concessionsCsv}))\n` +
    `- [Концеденти](${BASE}${PATHS.grantors}) ([CSV](${BASE}${PATHS.grantorsCsv}))\n` +
    `- [Компании](${BASE}${PATHS.companies}) ([CSV](${BASE}${PATHS.companiesCsv}))\n` +
    `- [Индикатори за риск](${BASE}${PATHS.flags}) ([CSV](${BASE}${PATHS.flagsCsv}))\n` +
    `- [Карта](${BASE}${PATHS.map}) ([GeoJSON](${BASE}${PATHS.mapGeojson}))\n` +
    `- [Методология](${BASE}${PATHS.methodology})`
  );
}

function mdConcessions(
  url: URL,
  heading: string,
  kind: string | null = url.searchParams.get("kind"),
): string {
  const q = url.searchParams.get("q");
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const { rows, total } = listConcessions({
    kind,
    status: url.searchParams.get("status"),
    flagged: url.searchParams.get("flagged") === "1",
    q,
    limit: LIST_LIMIT,
    offset: (page - 1) * LIST_LIMIT,
  });
  const filters = [...url.searchParams.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  return (
    `# ${heading}\n\n` +
    (filters ? `Филтри: ${filters}. ` : "") +
    `Общо ${total}; показани ${rows.length} (страница ${page}, ?page=N за следващите). ` +
    `Пълният резултат: [CSV](${BASE}${PATHS.concessionsCsv}${url.search}).\n\n` +
    concessionTable(rows)
  );
}

function mdConcessionDetail(param: string): string | null {
  const hit = resolveConcession(param);
  const d = hit ? getConcession(hit.reg_num) : null;
  if (!d) return null;
  const c = d.concession;
  const money = (
    raw: string | null,
    eur: number | null,
    flag: string,
  ): string =>
    raw == null && eur == null
      ? `— (${flag})`
      : `${raw ?? "—"}${eur != null ? ` = ${fmtEur(eur)}` : ""} (${flag})`;

  const lines = [
    `# Концесия ${c.reg_num} — ${c.title}`,
    ``,
    table(
      ["Поле", "Стойност"],
      [
        ["Вид", c.kind ? (CONCESSION_KIND_LABELS[c.kind] ?? c.kind) : "—"],
        ["Статус", c.status ?? "—"],
        ["Концедент", d.grantor?.name ?? "—"],
        [
          "Концесионер",
          d.concessionaire
            ? `${d.concessionaire.name}${d.concessionaire.eik ? ` (ЕИК ${d.concessionaire.eik})` : ""}`
            : "—",
        ],
        [
          "Срок",
          `${c.term_raw ?? "—"} → ${fmtMonths(c.term_months)} (${c.term_flag})`,
        ],
        ["Стойност", money(c.value_raw, c.value_eur, c.value_flag)],
        [
          "Еднократно възнаграждение",
          money(
            c.onetime_payment_raw,
            c.onetime_payment_eur,
            c.onetime_payment_flag,
          ),
        ],
        [
          "Годишно възнаграждение",
          money(
            c.annual_payment_raw,
            c.annual_payment_eur,
            c.annual_payment_flag,
          ),
        ],
        ["Гратисен период", c.grace_period_raw ?? "—"],
        ["Индексация", c.indexation_raw ?? "—"],
        ["Данни към", c.fetched_at],
      ],
    ),
  ];

  if (d.objects.length) {
    lines.push(
      ``,
      `## Обекти`,
      ``,
      ...d.objects.map(
        (o) => `- ${o.description} (${KIND_LABELS[o.kind] ?? o.kind})`,
      ),
    );
  }
  if (d.flags.length) {
    lines.push(
      ``,
      `## Индикатори за риск`,
      ``,
      ...d.flags.map(
        (f) =>
          `- **${f.code}** (тежест: ${SEVERITY_LABELS[f.severity] ?? f.severity}) — ${
            FLAG_DESCRIPTIONS[f.code] ?? ""
          }; входни данни: \`${f.inputs}\``,
      ),
    );
  }
  if (d.payments.length) {
    lines.push(
      ``,
      `## Плащания от общинските регистри`,
      ``,
      ...d.payments.map(
        (p) =>
          `- ${p.contracted_raw ?? "—"}${p.contracted_eur != null ? ` = ${fmtEur(p.contracted_eur)}` : ""} ([източник](${p.source_url}))`,
      ),
    );
  }
  lines.push(
    ``,
    `## Източници`,
    ``,
    `- Първичен: ${c.source_url}`,
    ...(c.announcement_url ? [`- Обявление: ${c.announcement_url}`] : []),
    ...d.documents.map(
      (doc) => `- ${doc.title ?? doc.kind ?? "документ"}: ${doc.url}`,
    ),
    ``,
    `Машинночетимо: [JSON](${BASE}${concessionHref(d.slug)}/json)`,
  );
  return lines.join("\n");
}

function mdGrantors(): string {
  const KIND: Record<string, string> = {
    municipality: "община",
    minister: "министър",
    other: "друг орган",
  };
  const rows = listGrantors();
  return (
    `# Концеденти\n\nОбщо ${rows.length}. Пълният списък: [CSV](${BASE}${PATHS.grantorsCsv}).\n\n` +
    table(
      ["Концедент", "Вид", "Концесии", "С индикатор"],
      rows
        .slice(0, LIST_LIMIT)
        .map((r) => [
          `[${r.name}](${BASE}${grantorHref(r.slug)})`,
          KIND[r.kind] ?? r.kind,
          r.concessions,
          r.flagged,
        ]),
    )
  );
}

function mdGrantorDetail(slug: string): string | null {
  const g = getGrantor(slug);
  if (!g) return null;
  return (
    `# ${g.grantor.name}\n\nКонцесии: ${g.concessions.length}.\n\n` +
    concessionTable(g.concessions.slice(0, LIST_LIMIT)) +
    (g.concessions.length > LIST_LIMIT
      ? `\n\nПоказани първите ${LIST_LIMIT} от ${g.concessions.length}.`
      : "")
  );
}

function mdCompanies(): string {
  const rows = listCompanies();
  return (
    `# Компании концесионери\n\nОбщо ${rows.length}, ключ е ЕИК. Пълният списък: [CSV](${BASE}${PATHS.companiesCsv}).\n\n` +
    table(
      ["Компания", "ЕИК", "Концесии", "Годишно общо (EUR)"],
      rows
        .slice(0, LIST_LIMIT)
        .map((r) => [
          r.eik ? `[${r.name}](${BASE}${companyHref(r.name, r.eik)})` : r.name,
          r.eik ?? "—",
          r.concessions,
          r.total_annual_eur == null ? "—" : fmtEur(r.total_annual_eur),
        ]),
    )
  );
}

function mdCompanyDetail(eik: string): string | null {
  const c = getCompany(eik);
  if (!c) return null;
  return (
    `# ${c.company.name} (ЕИК ${c.company.eik ?? eik})\n\nКонцесии: ${c.concessions.length}.\n\n` +
    concessionTable(c.concessions)
  );
}

function mdFlags(url: URL): string {
  const code = url.searchParams.get("code");
  const codes = listFlagCodes();
  const rows = listFlagged(code);
  return (
    `# Индикатори за риск\n\n` +
    `Индикаторът е възпроизводим аритметичен факт, не обвинение ([методология](${BASE}${PATHS.methodology})).\n\n` +
    table(
      ["Код", "Значение", "Брой"],
      codes.map((k) => [
        `[${k.code}](${BASE}${flagHref(k.code)})`,
        FLAG_DESCRIPTIONS[k.code] ?? "",
        k.n,
      ]),
    ) +
    `\n\n## Концесии${code ? ` с ${code}` : " с индикатор"} (първите ${LIST_LIMIT} от ${rows.length})\n\n` +
    concessionTable(rows.slice(0, LIST_LIMIT)) +
    `\n\nПълният списък: [CSV](${BASE}${PATHS.flagsCsv}${code ? `?code=${code}` : ""}).`
  );
}

function mdMethodology(): string {
  return (
    `# Методология на индикаторите за риск\n\n` +
    `Индикаторите се изчисляват детерминистично от данните и са публично ` +
    `документирани. Индикатор = възпроизводим аритметичен факт („годишното ` +
    `възнаграждение е 0,6% от стойността при 35-годишен срок"), никога ` +
    `обвинение в нарушение.\n\n` +
    table(
      ["Код", "Правило"],
      Object.entries(FLAG_DESCRIPTIONS).map(([code, desc]) => [code, desc]),
    ) +
    `\n\nПълната методология с праговете и обосновката: ` +
    `[docs/red-flags.md](https://github.com/B353N/koncesii/blob/main/docs/red-flags.md). ` +
    `Парични стойности: оригинал + нормализиран EUR (фиксиран курс 1.95583 ` +
    `BGN/EUR за предеврови стойности); противоречията между източниците се ` +
    `записват с флаг contradictory, не се разрешават мълчаливо.`
  );
}

/** „Анализи": заглавията и за какво са; самите текстове са HTML. */
function mdBlog(): string {
  return (
    `# Анализи върху данните за концесиите\n\n` +
    `Числата в текстовете идват от заявка към базата при отваряне на страницата.\n\n` +
    POSTS.map(
      (p) =>
        `- [${p.title}](${BASE}${blogHref(p.slug)}) — ${p.lead} (${p.published})`,
    ).join("\n")
  );
}

/** „Промени": какво се е променило при последните снемания. */
function mdChanges(): string {
  const dates = changeDates().slice(0, 12);
  const rows = recentlyChanged(LIST_LIMIT);
  if (dates.length === 0)
    return `# Промени\n\nПроследяването на промените започва със следващото снемане на регистрите.`;
  return (
    `# Промени в регистрите на концесиите\n\n` +
    `Последно обновяване: **${dates[0]!.changed_at}**, засегнати ${dates[0]!.n} партиди. ` +
    `Датата е на реалната промяна по партидата, не на снемането.\n\n` +
    `## Снемания\n\n` +
    table(
      ["Дата", "Променени партиди"],
      dates.map((d) => [d.changed_at, d.n]),
    ) +
    `\n\n## Последно променени партиди\n\n` +
    concessionTable(rows)
  );
}

function mdMap(): string {
  return (
    `# Карта на концесиите\n\n` +
    `Интерактивната карта е HTML изглед. Машинночетимите данни са в ` +
    `[karta.geojson](${BASE}${PATHS.mapGeojson}) — GeoJSON FeatureCollection с ` +
    `приблизителни центроиди (свойството precision показва точността).`
  );
}

/** null → пътят няма markdown изглед и се обслужва като HTML. */
export function renderMarkdown(url: URL): string | null {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const seg = (prefix: string): string | null =>
    path.startsWith(prefix) && path.length > prefix.length
      ? decodeURIComponent(path.slice(prefix.length))
      : null;

  let body: string | null = null;
  if (path === "/") body = mdHome();
  else if (path === PATHS.concessions) body = mdConcessions(url, "Концесии");
  else if (path === PATHS.search)
    body = mdConcessions(url, "Търсене в концесиите");
  else if (path === PATHS.grantors) body = mdGrantors();
  else if (path === PATHS.companies) body = mdCompanies();
  else if (path === PATHS.flags) body = mdFlags(url);
  else if (path === PATHS.methodology) body = mdMethodology();
  else if (path === PATHS.map) body = mdMap();
  else if (path === PATHS.changes) body = mdChanges();
  else if (path === PATHS.blog) body = mdBlog();
  else {
    // само каноничните адреси; старите минават през 301 като HTML-а
    const kindSeg = seg(`${PATHS.concessions}/vid/`);
    const kind = kindSeg ? kindOfSlug(kindSeg) : null;
    const regNum = seg(`${PATHS.concessions}/`);
    const grantor = seg(`${PATHS.grantors}/`);
    const company = seg(`${PATHS.companies}/`);
    if (kind?.canonical && kind.kind in KIND_LABELS)
      body = mdConcessions(
        url,
        KIND_PAGE_TITLES[kind.kind] ?? kind.kind,
        kind.kind,
      );
    else if (regNum && !regNum.includes("/")) body = mdConcessionDetail(regNum);
    else if (grantor) body = mdGrantorDetail(grantor);
    else if (company) {
      const eik = eikOfSlug(company);
      if (eik) body = mdCompanyDetail(eik);
    }
  }

  return body == null ? null : body + FOOTER;
}

export function markdownResponse(body: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      Vary: "Accept",
      // приблизителна оценка ~4 знака/токен, както при Markdown for Agents
      "x-markdown-tokens": String(Math.ceil(body.length / 4)),
      "X-Content-Type-Options": "nosniff",
    },
  });
}
