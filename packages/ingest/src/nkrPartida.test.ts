import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { parsePartida, previewMeta } from "./nkrPartida";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");
const html = readFileSync(join(FIXTURES, "partida.html"), "utf8");

test("вади уникалните Preview линкове", () => {
  const { previewLinks } = parsePartida(html);
  expect(previewLinks).toEqual([
    "/Preview/AssignedConcession/1a2b3c4d-5e6f-4a1b-8c2d-9e0f1a2b3c4d",
    "/Preview/ConcessionProcedure/9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a",
  ]);
});

test("вади файловите линкове, но не навигационните", () => {
  const { fileLinks } = parsePartida(html);
  expect(fileLinks).toEqual([
    "/Content/Download/reshenie-714.pdf",
    "/File/Download/aa11bb22-cc33-4d44-9e55-ff6677889900",
  ]);
});

test("намира заглавието на партидата", () => {
  expect(parsePartida(html).title).toBe("Партида на концесия O-000123");
});

test("previewMeta разпознава вид и guid", () => {
  expect(
    previewMeta(
      "/Preview/AssignedConcession/1A2B3C4D-5e6f-4a1b-8c2d-9e0f1a2b3c4d",
    ),
  ).toEqual({
    kind: "AssignedConcession",
    guid: "1a2b3c4d-5e6f-4a1b-8c2d-9e0f1a2b3c4d",
  });
  expect(previewMeta("/File/Download/x")).toBeNull();
});
