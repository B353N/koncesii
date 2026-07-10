import { expect, test } from "vitest";
import { geocode, parseLocation } from "./geocode";

test("парсва Местонахождение от обявлението", () => {
  expect(
    parseLocation(
      "Област: Бургас, Община: Несебър, Населено място: гр. Обзор, NUTS: BG341",
    ),
  ).toEqual({ oblast: "Бургас", municipality: "Несебър", place: "гр. Обзор" });
});

test("гео-кодира населено място, дисамбигуирано по област", () => {
  const g = geocode({
    oblast: "Бургас",
    municipality: "Несебър",
    place: "гр. Обзор",
  });
  expect(g?.precision).toBe("settlement");
  expect(g?.lat).toBeCloseTo(42.82, 1);
  expect(g?.lon).toBeCloseTo(27.88, 1);
});

test("пада back към центроида на общината", () => {
  const g = geocode({ oblast: "Бургас", municipality: "Несебър", place: null });
  expect(g?.precision).toBe("municipality");
});

test("двусмислие без разрешение по област = без координати", () => {
  // „Извор" съществува в много области; без област няма еднозначност
  expect(
    geocode({ oblast: null, municipality: null, place: "с. Извор" }),
  ).toBeNull();
});
