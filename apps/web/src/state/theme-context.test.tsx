import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { THEME_STORAGE_KEY } from "@/lib/theme";

import { ThemeProvider, useTheme } from "./theme-context";

const ThemeProbe = () => {
  const { preference, resolvedTheme, setPreference } = useTheme();
  return (
    <button type="button" onClick={() => setPreference("mocha")}>
      {preference}:{resolvedTheme}
    </button>
  );
};

describe("ThemeProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(THEME_STORAGE_KEY, "latte");
  });

  it("provides the selected theme and updates it through useTheme", () => {
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    expect(screen.getByRole("button").textContent).toBe("latte:latte");
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button").textContent).toBe("mocha:mocha");
  });
});
