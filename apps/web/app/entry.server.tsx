import { randomBytes } from "node:crypto";
import { PassThrough } from "node:stream";
import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter, type EntryContext } from "react-router";
import {
  markdownResponse,
  renderMarkdown,
  wantsMarkdown,
} from "./markdown.server";
import { NonceContext } from "./nonce";

const STREAM_TIMEOUT = 10_000;

/**
 * Строг CSP (docs/design.md, docs/architecture.md): всичко е 'self',
 * инлайн скриптовете на React Router минават през per-request nonce.
 * style 'unsafe-inline' покрива инлайн style атрибутите на React.
 * Външни източници: OSM тайловете (ADR-0004) и Google Analytics 4 —
 * домейните за GA са по CSP препоръката на Google за gtag.js.
 */
function csp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://*.googletagmanager.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.google-analytics.com https://*.googletagmanager.com",
    "font-src 'self' data:",
    // MapLibre тегли тайловете през fetch → connect-src, не img-src
    "connect-src 'self' https://tile.openstreetmap.org https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const CANONICAL_HOST = "koncesii.com";

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
) {
  // Каноничен адрес: www.* и http (X-Forwarded-Proto зад проксито) →
  // 301 към https://koncesii.com. Едно име, един протокол, за SEO и доверие.
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  const proto =
    request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  if (host !== CANONICAL_HOST || proto !== "https") {
    // локалната разработка не се пренасочва
    if (!host.startsWith("localhost") && !host.startsWith("127.")) {
      return new Response(null, {
        status: 301,
        headers: {
          Location: `https://${CANONICAL_HOST}${url.pathname}${url.search}`,
        },
      });
    }
  }

  // Markdown for Agents: Accept: text/markdown → markdown изглед на същия
  // URL. HTML остава по подразбиране; и двата варианта носят Vary: Accept.
  if (wantsMarkdown(request)) {
    const md = renderMarkdown(url);
    if (md) return markdownResponse(md);
  }
  responseHeaders.set("Vary", "Accept");
  // RFC 8288: къде са машинночетимите ресурси (RFC 9727 api-catalog)
  responseHeaders.set(
    "Link",
    '</.well-known/api-catalog>; rel="api-catalog", ' +
      '</openapi.json>; rel="service-desc", ' +
      '</methodology>; rel="service-doc"',
  );

  const nonce = randomBytes(16).toString("base64");
  responseHeaders.set("Content-Security-Policy", csp(nonce));
  responseHeaders.set("X-Content-Type-Options", "nosniff");
  responseHeaders.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains",
  );
  responseHeaders.set("Referrer-Policy", "strict-origin-when-cross-origin");

  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const userAgent = request.headers.get("user-agent");
    const readyOption =
      userAgent && isbot(userAgent) ? "onAllReady" : "onShellReady";

    const { pipe, abort } = renderToPipeableStream(
      <NonceContext.Provider value={nonce}>
        <ServerRouter context={routerContext} url={request.url} nonce={nonce} />
      </NonceContext.Provider>,
      {
        nonce,
        [readyOption]() {
          shellRendered = true;
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);
          responseHeaders.set("Content-Type", "text/html; charset=utf-8");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
          pipe(body);
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          if (shellRendered) console.error(error);
        },
      },
    );
    setTimeout(abort, STREAM_TIMEOUT);
  });
}
