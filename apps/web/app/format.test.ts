import { expect, test } from "vitest";
import {
  EGN_MASK,
  fmtEur,
  fmtMonths,
  fmtPercent,
  isEgn,
  maskEgn,
  shortObjectTitle,
  toCsv,
  withoutEgn,
} from "./format";

const nbsp = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

test("сумите са в български формат с €", () => {
  expect(nbsp(fmtEur(21457.56))).toBe("21 457,56 €");
  expect(fmtEur(null)).toBe("—");
});

test("сроковете показват и години при кръгли стойности", () => {
  expect(fmtMonths(420)).toBe("420 мес. (35 г.)");
  expect(fmtMonths(100)).toBe("100 мес.");
  expect(fmtMonths(null)).toBe("—");
});

test("процентите са с български десетичен знак", () => {
  expect(fmtPercent(0.0062)).toBe("0,62%");
});

test("CSV: UTF-8 BOM, екраниране на запетаи и кавички", () => {
  const csv = toCsv(
    ["a", "b"],
    [
      ["x,y", 'ка"вички'],
      [null, 5],
    ],
  );
  expect(csv.startsWith("﻿")).toBe(true);
  expect(csv).toContain('"x,y"');
  expect(csv).toContain('"ка""вички"');
  expect(csv.trim().split("\n")).toHaveLength(3);
});

test("краткият етикет вади името на находището и материала", () => {
  expect(
    shortObjectTitle(
      "Концесия за добив с предмет експлоатация на подземни богатства по чл. 2, ал. 1, т. 5 от Закона за подземните богатства (ЗПБ) – строителни материали – пясъци и чакъли, представляващи изключителна държавна собственост, от находище „Кайметлий“, разположено в землището",
    ),
  ).toBe("Находище „Кайметлий“, пясъци и чакъли");
  expect(
    shortObjectTitle(
      "КОНЦЕСИЯ ЗА ДОБИВ НА ПОДЗЕМНИ БОГАТСТВА ПО ЧЛ. 2, АЛ. 1, Т. 5 ОТ ЗАКОНА ЗА ПОДЗЕМНИТЕ БОГАТСТВА – СТРОИТЕЛНИ МАТЕРИАЛИ – ВАРОВИЦИ, ОТ НАХОДИЩЕ “ХИТРИНО - 3”, РАЗПОЛОЖЕНО",
    ),
  ).toBe("Находище „Хитрино - 3“, варовици");
});

test("краткият етикет на плаж и на свободен текст", () => {
  expect(
    shortObjectTitle(
      'Концесия за морски плаж "Панорама - север", община Варна, област Варна',
    ),
  ).toBe("Морски плаж „Панорама - север“");
  expect(
    shortObjectTitle("Атанасовска коса - част 1, община Бургас, област Бургас"),
  ).toBe("Атанасовска коса - част 1, община Бургас");
});

// Измислени ЕГН с валидна контролна цифра - не са на реални лица.
const EGN = "7501020018";

test("ЕГН: дата на раждане и контролна цифра", () => {
  expect(isEgn(EGN)).toBe(true);
  expect(isEgn("0541020035")).toBe(true); // роден след 2000 г. (месец + 40)
  expect(isEgn("7501020017")).toBe(false); // грешна контролна цифра
  expect(isEgn("7513020016")).toBe(false); // месец 13
  expect(isEgn("0888123456")).toBe(false); // мобилен телефон
  expect(isEgn("201207954")).toBe(false); // ЕИК, 9 цифри
});

test("maskEgn скрива ЕГН в текста и оставя другите числа", () => {
  expect(maskEgn(`Иван Иванов, ЕГН: ${EGN}, л.к. № 648572968`)).toBe(
    `Иван Иванов, ЕГН: ${EGN_MASK}, л.к. № 648572968`,
  );
  // етикетът е изкривен от OCR - хваща го контролната цифра
  expect(maskEgn(`Иванов, ErH- ${EGN} OTAp`)).toBe(
    `Иванов, ErH- ${EGN_MASK} OTAp`,
  );
  // след етикет се скрива и номер с грешна контролна цифра (печатна грешка)
  expect(maskEgn("с ЕГН 7501020017, от")).toBe(`с ЕГН ${EGN_MASK}, от`);
  expect(maskEgn(`[${EGN}]; на`)).toBe(`[${EGN_MASK}]; на`);
  // маркерите на snippet() не пречат
  expect(maskEgn("ЕГН \u00017501020017\u0002")).toBe(
    `ЕГН \u0001${EGN_MASK}\u0002`,
  );
  for (const keep of [
    "тел. 0888123456",
    "ЕИК 201207954",
    "ЕИК 1753468650125",
    "сметка BG80BNBG96611020345678",
    "2 300,81 лв.",
  ]) {
    expect(maskEgn(keep)).toBe(keep);
  }
});

test("withoutEgn маха ЕГН от името на концесионера и от идентификатора", () => {
  expect(withoutEgn(`Иван Петров Иванов с ЕГН ${EGN}`)).toBe(
    "Иван Петров Иванов",
  );
  expect(withoutEgn(`Иван Петров Иванов, ЕГН: ${EGN}`)).toBe(
    "Иван Петров Иванов",
  );
  expect(withoutEgn(`ЕТ „Иван Иванов" ЕГН № ${EGN}`)).toBe('ЕТ „Иван Иванов"');
  expect(withoutEgn(`name:иван-петров-иванов-с-егн-${EGN}`)).toBe(
    "name:иван-петров-иванов",
  );
  // без етикет - номерът се скрива, името остава
  expect(withoutEgn(`Иван Иванов ${EGN}`)).toBe(`Иван Иванов ${EGN_MASK}`);
  expect(withoutEgn(`ЕГН ${EGN}`)).toBe(`ЕГН ${EGN_MASK}`);
  for (const keep of ['"МАТ" ООД', "Сдружение Лесовъди", "eik:201207954"]) {
    expect(withoutEgn(keep)).toBe(keep);
  }
});
