import { expect, it } from "vitest";
import { moveGridSelection } from "./grid-navigation";

it("wraps Tab and Shift+Tab between rows", () => {
  expect(moveGridSelection({ row: 0, col: 2 }, "Tab", false, 2, 3)).toEqual({
    row: 1,
    col: 0,
  });
  expect(moveGridSelection({ row: 1, col: 0 }, "Tab", true, 2, 3)).toEqual({
    row: 0,
    col: 2,
  });
});

it("allows Tab to leave the first and last cells", () => {
  expect(moveGridSelection({ row: 0, col: 0 }, "Tab", true, 2, 3)).toBeNull();
  expect(moveGridSelection({ row: 1, col: 2 }, "Tab", false, 2, 3)).toBeNull();
});

it("keeps arrow movement inside the grid and ignores empty grids", () => {
  expect(moveGridSelection({ row: 0, col: 0 }, "ArrowUp", false, 2, 3)).toEqual(
    { row: 0, col: 0 },
  );
  expect(
    moveGridSelection({ row: 1, col: 2 }, "ArrowRight", false, 2, 3),
  ).toEqual({ row: 1, col: 2 });
  expect(
    moveGridSelection({ row: 0, col: 0 }, "Enter", false, 0, 3),
  ).toBeNull();
});
