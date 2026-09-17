import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { KnowledgePlaceholderPage, MemoryPlaceholderPage } from "./PlaceholderPage";

describe("placeholder pages", () => {
  it("announces the knowledge base as under construction", () => {
    render(
      <MemoryRouter>
        <KnowledgePlaceholderPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("知识库正在建设中")).toBeInTheDocument();
    expect(screen.getAllByText("即将上线").length).toBeGreaterThan(0);
  });

  it("announces memory as under construction", () => {
    render(
      <MemoryRouter>
        <MemoryPlaceholderPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("记忆正在建设中")).toBeInTheDocument();
    expect(screen.getAllByText("即将上线").length).toBeGreaterThan(0);
  });
});
