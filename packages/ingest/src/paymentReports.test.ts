import { describe, expect, test } from "vitest";
import { extractReportedPayments } from "./paymentReports";

const HEAD =
  "ИНФОРМАЦИЯ ЗА ИЗПЪЛНЕНИЕ НА КОНЦЕСИОНЕН ДОГОВОР По чл. 132, ал. 1 от Закона за концесиите за [2023] година (отчетна година)";

/** Т. 4.9 както е във формуляра, с подменими отметки и суми. */
function section({
  due = "[29 146,52 лв. без ДДС]",
  size = "☒ Пълно изпълнение ☐ Частично [въведете сума в лв. без ДДС] ☐ Пълно неизпълнение",
  onTime = "☒ Да ☐ Не[въведете вида и причини за неизпълнението]",
  arrears = "☐ Да [въведете сума в лв. без ДДС] ☒ Не",
} = {}): string {
  return (
    "4.9. Изпълнение на задължението за концесионно възнаграждение/концесионно плащане от концесионера: ☐ Не е приложимо за концесията ☒ Приложимо за отчетния период ☐ Не е приложимо " +
    `1) Дължим размер за отчетната година ${due} 2) Изпълнение на размера ${size} ` +
    `3) Изпълнение в срок: ${onTime} 4) Дължими суми от предходни години ${arrears} ` +
    "5) Платени суми за предходни години ☐ Да [въведете сума в лв. без ДДС] ☒ Не " +
    "4.10. Изпълнение на задължения за лихви, вкл. от предходни години 1) Дължими суми за отчетната година ☐ Да [въведете сума в лв. без ДДС] ☒ Не 2) Платени суми за отчетната година ☒ Пълно изпълнение"
  );
}

describe("extractReportedPayments", () => {
  test("дължимо, пълно изпълнение, в срок", () => {
    const [r] = extractReportedPayments([HEAD, section()]);
    expect(r).toMatchObject({
      year: 2023,
      dueRaw: "29 146,52 лв. без ДДС",
      dueAmount: 29146.52,
      dueCurrency: "BGN",
      fulfillment: "full",
      paidRaw: null,
      onTime: true,
      arrearsRaw: null,
      page: 2,
    });
    expect(r!.dueEur).toBeCloseTo(29146.52 / 1.95583, 2);
    // т. 4.10 (лихви) не влиза в цитата
    expect(r!.quote).not.toContain("лихви");
    expect(r!.quote.startsWith("Дължим размер")).toBe(true);
  });

  test("частично: платената сума е написаната, не изведена", () => {
    const [r] = extractReportedPayments([
      HEAD,
      section({
        due: "[7 209 евро]",
        size: "☐ Пълно изпълнение ☒ Частично [3274.66 лв] ☐ Пълно неизпълнение",
        onTime: "☐ Да ☒ Не",
      }),
    ]);
    expect(r).toMatchObject({
      dueAmount: 7209,
      dueCurrency: "EUR",
      fulfillment: "partial",
      paidRaw: "3274.66 лв",
      onTime: false,
    });
  });

  test("просрочие от предходни години се записва, когато е отметнато „Да“", () => {
    const [r] = extractReportedPayments([
      HEAD,
      section({ arrears: "☒ Да 69 972 евро без ДДС ☐ Не" }),
    ]);
    expect(r).toMatchObject({ arrearsRaw: "69 972 евро", arrearsEur: 69972 });
  });

  test("„Х“ на мястото на квадратчето също е отметка", () => {
    const [r] = extractReportedPayments([
      HEAD,
      section({
        size: "Х Пълно изпълнение ☐ Частично [въведете сума] ☐ Пълно неизпълнение",
        onTime: "Х☐ Да ☐ Не",
      }),
    ]);
    expect(r).toMatchObject({ fulfillment: "full", onTime: true });
  });

  test("OCR шум вместо квадратчета → статусът е неизвестен, не предположен", () => {
    const [r] = extractReportedPayments([
      HEAD,
      section({
        size: "64 Пълно изпълнение CJ Частично [въведете сума] CJ Пълно неизпълнение",
        onTime: "& Да CJ Не",
      }),
    ]);
    expect(r).toMatchObject({
      dueAmount: 29146.52,
      fulfillment: null,
      onTime: null,
    });
  });

  test("две отметки → неизвестно", () => {
    const [r] = extractReportedPayments([
      HEAD,
      section({
        size: "☒ Пълно изпълнение ☒ Частично [100 лв.] ☐ Пълно неизпълнение",
      }),
    ]);
    expect(r!.fulfillment).toBeNull();
  });

  test("празен формуляр („не е приложимо“) не дава запис", () => {
    expect(
      extractReportedPayments([
        HEAD,
        section({
          due: "[въведете данни] 1) ]",
          size: "☐ Пълно изпълнение ☐ Частично [въведете сума в лв. без ДДС] ☐ Пълно неизпълнение",
        }),
      ]),
    ).toEqual([]);
  });

  test("дължимото без сума се пази дословно, без число", () => {
    const [r] = extractReportedPayments([
      HEAD,
      section({
        due: "[Съгласно договора концесионерът ползва 5-годишен гратисен период. 1) ]",
      }),
    ]);
    expect(r).toMatchObject({
      dueRaw:
        "Съгласно договора концесионерът ползва 5-годишен гратисен период.",
      dueAmount: null,
      dueEur: null,
    });
  });

  test("сборен документ: всяка т. 4.9 взима годината на своя формуляр", () => {
    const rows = extractReportedPayments([
      HEAD,
      section({ due: "[1 000 лв.]" }),
      "за 2024 година (отчетна година)",
      section({ due: "[1 200 лв.]" }),
    ]);
    expect(rows.map((r) => [r.year, r.dueAmount, r.page])).toEqual([
      [2023, 1000, 2],
      [2024, 1200, 4],
    ]);
  });

  test("годината и без „(отчетна година)“, но само от заглавието", () => {
    const [r] = extractReportedPayments([
      "ИНФОРМАЦИЯ ЗА ИЗПЪЛНЕНИЕ НА КОНЦЕСИОНЕН ДОГОВОР По чл. 132, ал. 1 от Закона за концесиите за 2022 година Раздел I.",
      section(),
    ]);
    expect(r!.year).toBe(2022);
    const [s] = extractReportedPayments([
      "Плащането за 2021 година е извършено.",
      section(),
    ]);
    expect(s!.year).toBeNull();
  });

  test("детерминистично", () => {
    const pages = [HEAD, section()];
    expect(extractReportedPayments(pages)).toEqual(
      extractReportedPayments(pages),
    );
  });
});
