import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  NavLink,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import { useNonce } from "./nonce";
import "./app.css";

/** Google Analytics 4 — само в production, за да не шуми dev трафикът. */
const GA_ID = "G-GT7K4WV5PM";
const GA_INIT = `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_ID}');`;

const NAV = [
  ["/", "Начало"],
  ["/concessions", "Концесии"],
  ["/grantors", "Концеденти"],
  ["/companies", "Компании"],
  ["/map", "Карта"],
  ["/flags", "Индикатори"],
  ["/methodology", "Методология"],
] as const;

export function Layout({ children }: { children: React.ReactNode }) {
  const nonce = useNonce();
  return (
    <html lang="bg">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        {import.meta.env.PROD && (
          <>
            <script
              async
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
            />
            <script
              nonce={nonce}
              dangerouslySetInnerHTML={{ __html: GA_INIT }}
            />
          </>
        )}
      </head>
      <body className="bg-paper font-sans text-ink antialiased">
        <header className="border-b border-limestone">
          <div className="mx-auto flex h-14 max-w-5xl flex-wrap items-center gap-x-6 gap-y-1 px-5">
            <Link
              to="/"
              className="font-display text-lg font-bold tracking-[0.09em] text-ink no-underline"
            >
              КОНЦЕСИИ<span className="font-normal text-water-br">.com</span>
            </Link>
            <nav
              className="flex flex-wrap gap-x-4 text-[13.5px]"
              aria-label="Основна навигация"
            >
              {NAV.map(([to, label]) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    isActive
                      ? "py-1 text-water shadow-[inset_0_-2px_0_var(--color-water)]"
                      : "py-1 text-ink/80 hover:text-water"
                  }
                >
                  {label}
                </NavLink>
              ))}
            </nav>
            <Link
              to="/search"
              className="ml-auto rounded-[2px] border border-limestone bg-raised px-3 py-1 text-[13px] text-stone no-underline hover:border-water hover:text-water"
            >
              Търсене
            </Link>
          </div>
        </header>

        <main className="mx-auto min-h-[70vh] max-w-5xl px-5 pb-16">
          {children}
        </main>

        <footer className="border-t-[3px] border-double border-ink">
          <div className="mx-auto grid max-w-5xl gap-1.5 px-5 py-6 text-[13px] text-stone">
            <span>
              КОНЦЕСИИ — платформа за прозрачност на концесиите в България.
              Данните са публична информация от държавните регистри; всяко число
              е проследимо до източника си.
            </span>
            <span>
              <a
                className="text-water underline underline-offset-2"
                href="https://github.com/B353N/koncesii"
              >
                Отворен код и методология
              </a>{" "}
              ·{" "}
              <Link
                to="/methodology"
                className="text-water underline underline-offset-2"
              >
                Индикатори за риск — методология
              </Link>
            </span>
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
