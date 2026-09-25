import { expect, test } from "vitest";
import {
  clampDescription,
  concessionHeadline,
  concessionPageTitle,
  normalizePath,
  isGenericTitle,
  pagedLinkDescriptors,
  pagedMeta,
  pagedUrl,
  pageTitle,
} from "./seo";

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

test("заглавието е обектът и общината, без номера на партидата", () => {
  expect(
    concessionHeadline({
      title:
        'Концесия за морски плаж "Панорама - север", община Варна, област Варна',
      municipality: "Варна",
    }),
  ).toBe("Морски плаж „Панорама - север“, община Варна");
  expect(
    concessionHeadline({
      title:
        "Концесия за добив с предмет експлоатация на подземни богатства по чл. 2, ал. 1, т. 5 от Закона за подземните богатства (ЗПБ) – строителни материали – пясъци и чакъли, от находище „Вела“, разположено в землището на гр. Вълчедръм, община Вълчедръм, област Монтана",
      municipality: "Вълчедръм",
    }),
  ).toBe("Находище „Вела“, пясъци и чакъли, община Вълчедръм");
});

test("родовото заглавие се заменя с вида на концесията и обекта", () => {
  expect(
    concessionHeadline({
      title: "услуга",
      kindLabel: "Язовир",
      concessionKindLabel: "за услуги",
      objectDescription: "язовир - поземлен имот No 700142",
      grantorName: "Кмет на община Раковски",
    }),
  ).toBe(
    "Концесия за услуги: Язовир - поземлен имот No 700142, община Раковски",
  );
  expect(concessionHeadline({ title: "", kindLabel: "Добив" })).toBe(
    "Концесия: добив",
  );
});

test("общината не се повтаря, ако вече е в заглавието", () => {
  expect(
    concessionHeadline({
      title: "Концесия за услуга на язовир в землището на Община Дряново",
      grantorName: "Община Дряново",
    }),
  ).toBe("Концесия за услуга на язовир в землището на Община Дряново");
});

test("URL вместо име на концедент не влиза в заглавието", () => {
  const t = concessionHeadline({
    title: "Акт за собственост",
    grantorName: "https://www.dobrichka.bg/bg/259-registri",
  });
  expect(t).toBe("Акт за собственост");
});

test("<title> добавя „концесия“ и номера само при дубликат", () => {
  expect(
    concessionPageTitle(
      "Морски плаж „Панорама - север“, община Варна",
      "215-135/12.11.2021",
      false,
    ),
  ).toBe("Морски плаж „Панорама - север“, община Варна - концесия");
  expect(
    concessionPageTitle(
      "Концесия за строителство на автобусни спирки, община Варна",
      "O-000694",
      true,
    ),
  ).toBe(
    "Концесия за строителство на автобусни спирки, община Варна (партида O-000694)",
  );
  expect(
    concessionPageTitle(
      "Строителство",
      "18ffa14c-d585-43e0-a663-ba0091cae6b9#4",
      true,
    ),
  ).toBe("Строителство - концесия (партида общински регистър 18ffa14c/4)");
});

test("дългото регистрово заглавие се реже на смислен разделител", () => {
  const t = concessionHeadline({
    title:
      "Концесия за услуги на обект: Язовир „МОМИНО“, представляващ ПОЗЕМЛЕН ИМОТ с идентификатор 48948.82.78, находящ се в област Пловдив, община Раковски, село Момино село",
    grantorName: "Кмет на община Раковски",
  });
  expect(t.length).toBeLessThanOrEqual(100);
  expect(t.startsWith("Концесия за услуги на обект: Язовир „МОМИНО“")).toBe(
    true,
  );
});

test("родовите заглавия се разпознават без оглед на кавички и регистър", () => {
  expect(isGenericTitle("Особено право на ползване")).toBe(true);
  expect(isGenericTitle("„Услуга“")).toBe(true);
  expect(isGenericTitle("3")).toBe(true);
  expect(
    isGenericTitle('Концесия за морски плаж "Буните 2", област Варна'),
  ).toBe(false);
});

test("описанието се подрязва по дума, не по знак", () => {
  const d = clampDescription("а".repeat(50) + " " + "б".repeat(400), 100);
  expect(d.length).toBeLessThanOrEqual(101);
  expect(d.endsWith("…")).toBe(true);
});

test("адресът се нормализира до малки букви и без / накрая", () => {
  expect(normalizePath("/koncesii/")).toBe("/koncesii");
  expect(normalizePath("/KONCESII/Vid/Yazoviri")).toBe(
    "/koncesii/vid/yazoviri",
  );
  expect(normalizePath("/")).toBe("/");
  expect(normalizePath("/koncesii")).toBe("/koncesii");
});
