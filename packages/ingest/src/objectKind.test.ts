import { expect, test } from "vitest";
import { classifyObjectKind } from "./objectKind";

test("класифицира по таксономията от core-scope.md", () => {
  expect(classifyObjectKind("язовир „Мътница“, ПИ 49014.870.522")).toBe("dam");
  expect(classifyObjectKind("морски плаж „Слънчев бряг – юг“")).toBe("beach");
  expect(
    classifyObjectKind("добив на подземни богатства от находище „Върба“"),
  ).toBe("mining");
  expect(classifyObjectKind("находище на минерална вода „Беден“")).toBe(
    "mineral_water",
  );
  expect(classifyObjectKind("пристанище „Свети Никола“")).toBe("port");
  expect(classifyObjectKind("поземлен имот с идентификатор 12345.67.89")).toBe(
    "property",
  );
});

test("по-специфичното правило печели", () => {
  expect(
    classifyObjectKind("добив на инертни материали от кариера „Плоски дол“"),
  ).toBe("quarry");
});

test("дейност по поддържане и управление е service", () => {
  expect(
    classifyObjectKind("поддържане и управление на спортен комплекс"),
  ).toBe("service");
});

test("непознат предмет е other", () => {
  expect(classifyObjectKind("временна експозиция")).toBe("other");
  expect(classifyObjectKind("акваторията на залива")).toBe("other");
  expect(classifyObjectKind("")).toBe("other");
});
