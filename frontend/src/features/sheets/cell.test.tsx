import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { CellValue } from "./Cell";
import { newField } from "./model";

it("keeps unset checkbox cells visible as unchecked controls", () => {
  const field = newField("checkbox");
  const { rerender } = render(<CellValue field={field} value={null} />);
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(screen.getByRole("checkbox")).toBeDisabled();
  rerender(<CellValue field={field} value={null} interactive />);
  expect(screen.getByRole("checkbox")).toBeEnabled();
});
