import {
  completenessStats,
  kindStats,
  termBands,
  topByTerm,
  topGrantorsByKind,
  topPaymentsByKind,
} from "../queries.server";
import type {
  BeachesData,
  DamsData,
  LongTermsData,
  MissingDataData,
} from "./posts";

/**
 * Данните за анализите. Живеят отделно от текста (posts.tsx), защото
 * компонентите се рендират и на клиента, а заявките към SQLite - само на
 * сървъра. Типът на всеки набор е деклариран в posts.tsx, за да не може
 * текстът да иска поле, което заявката не връща.
 */

const LOADERS = {
  "kakvo-lipsva-v-registrite": (): MissingDataData => ({
    stats: completenessStats(),
    dams: kindStats("dam"),
    beaches: kindStats("beach"),
  }),
  "yazovirite-pod-koncesiya": (): DamsData => ({
    stats: kindStats("dam"),
    terms: termBands("dam"),
    grantors: topGrantorsByKind("dam", 8),
    top: topPaymentsByKind("dam", 8),
  }),
  "dulgite-srokove": (): LongTermsData => ({
    all: termBands(null),
    longest: topByTerm(10),
  }),
  "morskite-plazhove": (): BeachesData => ({
    stats: kindStats("beach"),
    terms: termBands("beach"),
    top: topPaymentsByKind("beach", 8),
    grantors: topGrantorsByKind("beach", 5),
  }),
} as const;

export function loadPostData(slug: string): unknown {
  const loader = LOADERS[slug as keyof typeof LOADERS];
  return loader ? loader() : null;
}
