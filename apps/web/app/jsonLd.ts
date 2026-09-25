import type { Crumb } from "./components";
import { absUrl, SITE, SITE_NAME } from "./seo";

/**
 * Structured data (schema.org, JSON-LD). Описва само това, което вече е
 * на страницата, и винаги сочи към източника: партидата е `CreativeWork`
 * с `isBasedOn` към НКР/data.egov.bg, а не измислен `Dataset`.
 *
 * JSON-LD не се изпълнява като скрипт, затова CSP nonce не му трябва.
 */

export type JsonLd = Record<string, unknown>;

export function jsonLdScript(data: JsonLd | JsonLd[]): {
  __html: string;
} {
  // </script> в данните би затворил тага; JSON-encode-ваме го безопасно.
  return {
    __html: JSON.stringify(data).replace(/</g, "\\u003c"),
  };
}

export function websiteJsonLd(): JsonLd[] {
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": `${SITE}/#website`,
      name: SITE_NAME,
      alternateName: "Концесии в България",
      url: `${SITE}/`,
      inLanguage: "bg",
      publisher: { "@id": `${SITE}/#organization` },
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: `${SITE}/tarsene?q={search_term_string}`,
        },
        "query-input": "required name=search_term_string",
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": `${SITE}/#organization`,
      name: SITE_NAME,
      url: `${SITE}/`,
      description:
        "Публичен портал за концесиите в България: всяка партида е проследима до официалния регистър.",
      sameAs: ["https://github.com/B353N/koncesii"],
    },
  ];
}

export function breadcrumbJsonLd(items: Crumb[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.label,
      ...(c.to ? { item: absUrl(c.to) } : {}),
    })),
  };
}

export interface ConcessionJsonLdInput {
  url: string;
  name: string;
  description: string;
  regNum: string;
  sourceUrl: string;
  fetchedAt: string;
  grantorName: string | null;
  grantorUrl: string | null;
  concessionaireName: string | null;
  concessionaireEik: string | null;
  concessionaireUrl: string | null;
  /** Мястото на обекта; координатите са центроид (приблизителни). */
  place?: {
    name: string | null;
    municipality: string | null;
    oblast: string | null;
    lat: number | null;
    lon: number | null;
  } | null;
}

function placeJsonLd(p: NonNullable<ConcessionJsonLdInput["place"]>): JsonLd {
  return {
    "@type": "Place",
    ...(p.name ? { name: p.name } : {}),
    address: {
      "@type": "PostalAddress",
      ...(p.municipality
        ? { addressLocality: `община ${p.municipality}` }
        : {}),
      ...(p.oblast ? { addressRegion: `област ${p.oblast}` } : {}),
      addressCountry: "BG",
    },
    ...(p.lat != null && p.lon != null
      ? {
          geo: {
            "@type": "GeoCoordinates",
            latitude: p.lat,
            longitude: p.lon,
          },
        }
      : {}),
  };
}

export function concessionJsonLd(c: ConcessionJsonLdInput): JsonLd {
  const about: JsonLd[] = [];
  if (c.grantorName) {
    about.push({
      "@type": "GovernmentOrganization",
      name: c.grantorName,
      ...(c.grantorUrl ? { url: c.grantorUrl } : {}),
    });
  }
  if (c.concessionaireName) {
    about.push({
      "@type": "Organization",
      name: c.concessionaireName,
      ...(c.concessionaireEik
        ? {
            identifier: {
              "@type": "PropertyValue",
              propertyID: "ЕИК",
              value: c.concessionaireEik,
            },
          }
        : {}),
      ...(c.concessionaireUrl ? { url: c.concessionaireUrl } : {}),
    });
  }
  return {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    "@id": `${c.url}#concession`,
    url: c.url,
    name: c.name,
    description: c.description,
    inLanguage: "bg",
    identifier: {
      "@type": "PropertyValue",
      propertyID: "Партида",
      value: c.regNum,
    },
    isBasedOn: c.sourceUrl,
    dateModified: c.fetchedAt,
    isPartOf: { "@id": `${SITE}/#website` },
    ...(about.length ? { about } : {}),
    ...(c.place ? { spatialCoverage: placeJsonLd(c.place) } : {}),
  };
}

/** Списък от партиди: ItemList с адресите, без дублиране на съдържание. */
export function itemListJsonLd(
  urls: string[],
  { startIndex = 1 }: { startIndex?: number } = {},
): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    numberOfItems: urls.length,
    itemListElement: urls.map((url, i) => ({
      "@type": "ListItem",
      position: startIndex + i,
      url,
    })),
  };
}
