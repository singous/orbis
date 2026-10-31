import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, expect, it } from "vitest";
import { authStore } from "../../src/shared/auth/auth-store";
import { RequireAuth } from "../../src/shared/auth/RequireAuth";

afterEach(cleanup);
it("preserves query and fragment when sending a protected URL to login", () => {
  authStore.getState().clearSession();
  function LoginTarget() { const location = useLocation(); return <output>{(location.state as { from: string }).from}</output>; }
  render(<MemoryRouter initialEntries={["/search?q=report&type=document#result"]}><Routes><Route path="/search" element={<RequireAuth>Protected content</RequireAuth>} /><Route path="/login" element={<LoginTarget />} /></Routes></MemoryRouter>);
  expect(screen.getByText("/search?q=report&type=document#result")).toBeInTheDocument();
});
