import { expect, test } from "vitest";
import {
  clampDescription,
  concessionTitle,
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

test("родовото заглавие се допълва с обект, концедент и партида", () => {
  expect(
    concessionTitle({
      title: "услуга",
      regNum: "O-001105",
      kindLabel: "Язовир",
      objectDescription: "язовир - поземлен имот No 700142",
      grantorName: "Община Раковски",
      concessionKindLabel: "за услуги",
    }),
  ).toBe(
    "Концесия за услуги · язовир - поземлен имот No 700142 · Община Раковски · партида O-001105",
  );
});

test("празното заглавие пак дава използваемо заглавие", () => {
  expect(
    concessionTitle({
      title: "",
      regNum: "D-000413",
      kindLabel: "Добив",
      grantorName: "Министерски съвет",
    }),
  ).toBe("Концесия · добив · Министерски съвет · партида D-000413");
});

test("конкретното заглавие се запазва и се допълва с концедента", () => {
  const t = concessionTitle({
    title: 'Концесия за морски плаж "Слънчев бряг - юг", община Несебър',
    regNum: "215-148/02.02.2022",
    grantorName: "Министерски съвет",
  });
  expect(t).toBe(
    'Концесия за морски плаж "Слънчев бряг - юг", община Несебър · Министерски съвет · партида 215-148/02.02.2022',
  );
});

test("концедентът не се дублира, ако вече е в заглавието", () => {
  const t = concessionTitle({
    title: "Концесия за услуга на язовир в землището на Община Дряново",
    regNum: "223-26/13.06.2019",
    grantorName: "Община Дряново",
  });
  expect(t).toBe(
    "Концесия за услуга на язовир в землището на Община Дряново · партида 223-26/13.06.2019",
  );
});

test("дългото регистрово заглавие се реже на смислен разделител", () => {
  const long =
    "Концесия за добив с предмет експлоатация на подземни богатства по чл. 2, ал. 1, т. 5 от Закона за подземните богатства (ЗПБ) – строителни материали – пясъци и чакъли, от находище „Вела“, разположено в землището на гр. Вълчедръм, община Вълчедръм, област Монтана";
  const t = concessionTitle({ title: long, regNum: "216-275/12.09.2023" });
  // отрязаното заглавие носи номера на партидата, за да остане уникално
  expect(t.endsWith(" · партида 216-275/12.09.2023")).toBe(true);
  expect(t.length).toBeLessThanOrEqual(140);
  const head = t.replace(" · партида 216-275/12.09.2023", "");
  expect(long.startsWith(head.replace(/…$/, ""))).toBe(true);
});

test("заглавието с концедент и номер се събира в 140 знака", () => {
  const t = concessionTitle({
    title:
      "Концесия за услуги на обект: Язовир „МОМИНО“, представляващ ПОЗЕМЛЕН ИМОТ с идентификатор 48948.82.78, находящ се в област Пловдив, община Раковски, село Момино село",
    regNum: "222-337/05.11.2024",
    grantorName: "Кмет на община Раковски",
  });
  expect(t.length).toBeLessThanOrEqual(140);
  expect(t).toContain("партида 222-337/05.11.2024");
});

test("две партиди с дословно еднакво заглавие се различават по номер", () => {
  const title =
    "Концесия за строителство на автобусни спирки, област Варна, община Варна";
  const grantorName = "Кмет на община Варна";
  expect(concessionTitle({ title, regNum: "O-000694", grantorName })).not.toBe(
    concessionTitle({ title, regNum: "O-000696", grantorName }),
  );
});

test("URL вместо име на концедент не влиза в заглавието", () => {
  const t = concessionTitle({
    title: "Акт за собственост",
    regNum: "84682a15-05df-46f6-a327-e24e680c9068#58892",
    grantorName: "https://www.dobrichka.bg/bg/259-registri",
  });
  expect(t).not.toContain("http");
  expect(t).toBe(
    "Акт за собственост · партида общински регистър 84682a15/58892",
  );
});

test("два общински регистъра с еднакъв номер на ред не се сливат", () => {
  const title = "Строителство";
  expect(
    concessionTitle({
      title,
      regNum: "18ffa14c-d585-43e0-a663-ba0091cae6b9#4",
    }),
  ).not.toBe(
    concessionTitle({
      title,
      regNum: "25e11dfc-43cc-450e-84ad-5c616d4aef99#4",
    }),
  );
});

test("две партиди с еднакво начало на заглавието не се сливат", () => {
  const a =
    "Концесия за строителство в поземлен имот, публична общинска собственост - язовир с идентификатор 87076.149.48 - с. Ябълково, общ. Димитровград";
  const b =
    "Концесия за строителство в поземлен имот, публична общинска собственост - воден обект с идентификатор 69691.19.58, с. Странско, общ. Димитровград";
  const grantorName = "Кмет на община Димитровград";
  expect(
    concessionTitle({ title: a, regNum: "221-121/18.10.2021", grantorName }),
  ).not.toBe(
    concessionTitle({ title: b, regNum: "221-205/17.01.2023", grantorName }),
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
