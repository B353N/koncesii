import { expect, test } from "vitest";
import { pagedLinkDescriptors, pagedMeta, pagedUrl, pageTitle } from "./seo";

test("заглавието носи един и същ суфикс на сайта", () => {
  expect(pageTitle("Концесии")).toBe("Концесии | КОНЦЕСИИ");
});

test("страница 1 е чистият адрес, останалите носят ?page=", () => {
  expect(pagedUrl("/concessions", 1)).toBe("https://koncesii.com/concessions");
  expect(pagedUrl("/concessions", 2)).toBe(
    "https://koncesii.com/concessions?page=2",
  );
});

test("canonical на страница N сочи към самата нея, с prev/next", () => {
  const m = pagedMeta("/concessions/vid/dam", 3, 10);
  expect(m.canonical).toBe("https://koncesii.com/concessions/vid/dam?page=3");
  expect(m.prev).toBe("https://koncesii.com/concessions/vid/dam?page=2");
  expect(m.next).toBe("https://koncesii.com/concessions/vid/dam?page=4");
  expect(m.pageLabel).toBe("страница 3 от 10");
});

test("първата и последната страница нямат prev/next извън обхвата", () => {
  const first = pagedMeta("/concessions", 1, 4);
  expect(first.prev).toBeNull();
  expect(first.next).toBe("https://koncesii.com/concessions?page=2");
  expect(first.pageLabel).toBeNull();
  const last = pagedMeta("/concessions", 4, 4);
  expect(last.next).toBeNull();
  // страница извън обхвата се свежда до последната
  expect(pagedMeta("/concessions", 99, 4).canonical).toBe(
    "https://koncesii.com/concessions?page=4",
  );
});

test("descriptor-ите съдържат canonical и само наличните prev/next", () => {
  const d = pagedLinkDescriptors(pagedMeta("/concessions", 1, 1));
  expect(d).toEqual([
    {
      tagName: "link",
      rel: "canonical",
      href: "https://koncesii.com/concessions",
    },
  ]);
});
