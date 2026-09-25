// Парсерите и нормализаторите на ingest слоя (M1). Референтната
// имплементация е tools/harvest/*.py; TS версиите тук са каноничните
// занапред и са покрити с тестове върху фикстури (fixtures/).
export { normText, NO_DATA_RE } from "./text";
export { parseMoney, parseDecimal, eurFrom, type ParsedMoney } from "./money";
export { parseTerm, type ParsedTerm } from "./term";
export { extractEik } from "./eik";
export { cleanConcessionaireName } from "./concessionaireName";
export { classifyObjectKind } from "./objectKind";
export { parseNkrExport, decodeWindows1251, type NkrExport } from "./nkrExport";
export { parsePartida, previewMeta, type PartidaLinks } from "./nkrPartida";
export {
  parsePreview,
  splitNumbered,
  type ParsedPreview,
  type PreviewSection,
} from "./nkrAnnouncement";
export {
  HEADER_MAP,
  mapHeaders,
  extractRows,
  normalizeResource,
  type EgovDatasetMeta,
  type EgovRecord,
  type NormalizedResource,
  type HeaderMapping,
} from "./egov";
export {
  ANCHORS,
  documentRank,
  extractDocAmounts,
  extractDocFacts,
  normalizeDocText,
  parseDocNumber,
  splitPages,
  type DocAmount,
  type DocFact,
  type DocFactField,
} from "./documentFacts";
export {
  extractReportedPayments,
  type Fulfillment,
  type ReportedPayment,
} from "./paymentReports";
