import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  NavLink,
  Outlet,
  Scripts,
  ScrollRestoration,
  useMatches,
} from "react-router";

import type { Route } from "./+types/root";
import { jsonLdScript, websiteJsonLd } from "./jsonLd";
import { useNonce } from "./nonce";
import "./app.css";
// Шрифтовете на първия екран (текст и заглавие, кирилица) - preload, за да
// не чака браузърът CSS-а, за да ги открие. Същият файл като в @font-face.
import manropeCyr400 from "@fontsource/manrope/files/manrope-cyrillic-400-normal.woff2?url";
import unboundedCyr700 from "@fontsource/unbounded/files/unbounded-cyrillic-700-normal.woff2?url";

export const links: Route.LinksFunction = () =>
  [manropeCyr400, unboundedCyr700].map((href) => ({
    rel: "preload",
    href,
    as: "font",
    type: "font/woff2",
    crossOrigin: "anonymous" as const,
  }));
import { PATHS } from "./paths";

/** Google Analytics 4 — само в production, за да не шуми dev трафикът. */
const GA_ID = "G-GT7K4WV5PM";
/**
 * gtag.js (173 KB) тръгва след `load` и в първия свободен момент на главната
 * нишка, не в head: събитията се трупат в dataLayer и се пращат, щом
 * зареди, а първият екран не се състезава с него за канала и процесора.
 * Външният скрипт е позволен от script-src (entry.server.tsx).
 */
const GA_INIT = `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_ID}');
addEventListener('load', function () {
  var go = function () {
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=${GA_ID}';
    document.head.appendChild(s);
  };
  if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 4000 });
  else setTimeout(go, 1500);
});`;

/** Основната навигация: един ред. Останалото е в менюто „Още" и във футъра. */
const NAV = [
  [PATHS.home, "Начало"],
  [PATHS.map, "Карта"],
  [PATHS.concessions, "Концесии"],
  [PATHS.municipalities, "Общини"],
  [PATHS.companies, "Компании"],
  [PATHS.grantors, "Концеденти"],
  [PATHS.flags, "Индикатори"],
  [PATHS.blog, "Анализи"],
] as const;
const NAV_MORE = [
  [PATHS.changes, "Промени"],
  [PATHS.methodology, "Методология"],
  [PATHS.search, "Търсене"],
] as const;

/** Страници на цяла ширина (картата) слагат `handle = { fullBleed: true }`. */
export interface RouteHandle {
  fullBleed?: boolean;
}

/** Wordmark-ът: флагче на пилон. Флагът е в цвета на високата тежест. */
function LogoMark() {
  return (
    <svg width="16" height="20" viewBox="0 0 18 22" aria-hidden="true">
      <path
        d="M2 1v20"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path d="M3 2h13l-3.5 4.5L16 11H3z" fill="var(--color-sev-high)" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </svg>
  );
}

const navPill = ({ isActive }: { isActive: boolean }) =>
  `rounded-full px-1.5 py-1.5 text-[14px] font-semibold whitespace-nowrap no-underline xl:px-3 xl:text-[14.5px] ${
    isActive ? "bg-ink text-white" : "text-ink hover:bg-paper"
  }`;

export function Layout({ children }: { children: React.ReactNode }) {
  const nonce = useNonce();
  const fullBleed = useMatches().some(
    (m) => (m.handle as RouteHandle | undefined)?.fullBleed,
  );
  return (
    <html lang="bg">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="icon" href="/favicon.png" type="image/png" sizes="64x64" />
        <meta property="og:site_name" content="КОНЦЕСИИ" />
        <meta property="og:type" content="website" />
        <meta property="og:locale" content="bg_BG" />
        <meta property="og:image" content="https://koncesii.com/og.png" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta name="twitter:card" content="summary_large_image" />
        <Meta />
        <Links />
        {/* Сайтът като обект: WebSite + Organization, веднъж за всички страници. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={jsonLdScript(websiteJsonLd())}
        />
        {import.meta.env.PROD && (
          <script nonce={nonce} dangerouslySetInnerHTML={{ __html: GA_INIT }} />
        )}
      </head>
      <body className="bg-paper font-sans text-[15px] text-ink antialiased">
        <header className="relative z-20 border-b border-limestone bg-raised">
          <div className="flex h-[58px] items-center gap-6 px-4 sm:px-5">
            <Link
              to="/"
              aria-label="Концесии - начало"
              className="flex items-center gap-2 font-display text-[17px] font-bold text-ink no-underline"
            >
              <LogoMark />
              концесии
            </Link>
            <nav
              className="hidden min-w-0 flex-1 lg:flex xl:gap-0.5"
              aria-label="Основна навигация"
            >
              {NAV.map(([to, label]) => (
                <NavLink key={to} to={to} className={navPill}>
                  {label}
                </NavLink>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-1">
              <Link
                to={PATHS.search}
                aria-label="Търсене"
                className="flex items-center gap-2 rounded-full px-3 py-1.5 text-[14px] font-semibold text-stone no-underline hover:bg-paper hover:text-ink"
              >
                <SearchIcon />
                <span className="hidden sm:inline">Търсене</span>
              </Link>
              <details className="group relative">
                <summary className="flex cursor-pointer list-none items-center rounded-full px-3 py-1.5 text-[14px] font-semibold text-ink hover:bg-paper [&::-webkit-details-marker]:hidden">
                  <span className="lg:hidden">Меню</span>
                  <span className="hidden lg:inline">Още</span>
                </summary>
                <div className="absolute right-0 mt-2 grid w-56 gap-0.5 rounded-2xl border border-limestone bg-raised p-2 shadow-[0_12px_34px_rgba(21,33,43,.14)]">
                  {NAV.map(([to, label]) => (
                    <NavLink
                      key={to}
                      to={to}
                      className={(a) => `${navPill(a)} lg:hidden`}
                    >
                      {label}
                    </NavLink>
                  ))}
                  {NAV_MORE.map(([to, label]) => (
                    <NavLink key={to} to={to} className={navPill}>
                      {label}
                    </NavLink>
                  ))}
                </div>
              </details>
            </div>
          </div>
        </header>

        {fullBleed ? (
          <main>{children}</main>
        ) : (
          <main className="mx-auto min-h-[70vh] max-w-5xl px-4 pb-16 sm:px-5">
            {children}
          </main>
        )}

        <footer className="border-t border-limestone bg-raised">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-[14px] text-stone sm:grid-cols-[1.4fr_1fr_1fr] sm:px-5">
            <div>
              <Link
                to="/"
                aria-label="Концесии - начало"
                className="flex items-center gap-2 font-display text-[15px] font-bold text-ink no-underline"
              >
                <LogoMark />
                концесии
              </Link>
              <p className="mt-3 max-w-[46ch]">
                Платформа за прозрачност на концесиите в България. Данните са
                публична информация от държавните регистри и всяко число води до
                източника си.
              </p>
            </div>
            <nav aria-label="Данни" className="grid content-start gap-1.5">
              {NAV.map(([to, label]) => (
                <Link key={to} to={to} className="text-ink hover:text-water">
                  {label}
                </Link>
              ))}
            </nav>
            <nav aria-label="За проекта" className="grid content-start gap-1.5">
              <Link
                to={PATHS.methodology}
                className="text-ink hover:text-water"
              >
                Методология на индикаторите
              </Link>
              <Link to={PATHS.changes} className="text-ink hover:text-water">
                Промени в регистъра
              </Link>
              <a href="/openapi.json" className="text-ink hover:text-water">
                Отворени данни и API
              </a>
              <a
                href="https://github.com/B353N/koncesii"
                className="text-ink hover:text-water"
              >
                Отворен код
              </a>
              <span className="mt-3">
                Изработка на сайта:{" "}
                <a
                  className="text-stone underline underline-offset-2 hover:text-water"
                  href="https://prowebsite.bg/"
                  title="ProWebsite.bg - изработка на уеб сайтове и онлайн магазини"
                  target="_blank"
                  rel="noopener"
                >
                  ProWebsite.bg - изработка на уеб сайтове
                </a>
              </span>
            </nav>
          </div>
        </footer>

        <ScrollRestoration nonce={nonce} />
        <Scripts nonce={nonce} />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Грешка";
  let details = "Възникна неочаквана грешка.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Грешка";
    details =
      error.status === 404
        ? "Страницата не беше намерена. Проверете адреса или потърсете обекта."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16">
      <h1 className="font-display text-3xl font-bold">{message}</h1>
      <p className="mt-2 text-stone">{details}</p>
      <p className="mt-4">
        <Link to="/" className="text-water underline underline-offset-2">
          Към началото
        </Link>
      </p>
      {stack && (
        <pre className="mt-6 w-full overflow-x-auto border border-limestone bg-raised p-4 text-xs">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
