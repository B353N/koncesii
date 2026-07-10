import test from "node:test";
import assert from "node:assert/strict";
import { extractLinks } from "./check-docs.mjs";

test("extracts relative markdown links", () => {
  const md = "See [arch](architecture.md) and [adr](adr/README.md).";
  assert.deepEqual(extractLinks(md), ["architecture.md", "adr/README.md"]);
});

test("ignores external, mailto and anchor links", () => {
  const md =
    "[a](https://example.com) [b](mailto:x@y.z) [c](#section) [d](http://x)";
  assert.deepEqual(extractLinks(md), []);
});

test("strips anchors from relative links", () => {
  assert.deepEqual(extractLinks("[a](etl.md#sources)"), ["etl.md"]);
});
