import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LogFileCandidateModal } from "./LogFileCandidateModal";

describe("LogFileCandidateModal", () => {
  it("renders candidates and selects clicked item", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <LogFileCandidateModal
        state={{
          open: true,
          reference: "index.ts",
          items: [
            { path: "apps/server/src/index.ts", name: "index.ts" },
            { path: "apps/web/src/index.ts", name: "index.ts", isIgnored: true },
          ],
        }}
        actions={{
          onClose,
          onSelect,
        }}
      />,
    );

    expect(screen.getByText('Multiple files matched "index.ts"')).toBeTruthy();
    fireEvent.click(screen.getByText("apps/web/src/index.ts"));
    expect(onSelect).toHaveBeenCalledWith("apps/web/src/index.ts");
  });

  it("filters items by command input", () => {
    render(
      <LogFileCandidateModal
        state={{
          open: true,
          reference: "index.ts",
          items: [
            { path: "apps/server/src/index.ts", name: "index.ts" },
            { path: "apps/web/src/index.ts", name: "index.ts" },
          ],
        }}
        actions={{
          onClose: vi.fn(),
          onSelect: vi.fn(),
        }}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Search files..."), {
      target: { value: "apps/server" },
    });

    expect(screen.getByText("apps/server/src/index.ts")).toBeTruthy();
    expect(screen.queryByText("apps/web/src/index.ts")).toBeNull();
  });

  it("focuses the search input when opened", async () => {
    render(
      <LogFileCandidateModal
        state={{
          open: true,
          reference: "index.ts",
          items: [{ path: "apps/server/src/index.ts", name: "index.ts" }],
        }}
        actions={{
          onClose: vi.fn(),
          onSelect: vi.fn(),
        }}
      />,
    );

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByPlaceholderText("Search files..."));
    });
  });

  it("closes when close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <LogFileCandidateModal
        state={{
          open: true,
          reference: "index.ts",
          items: [{ path: "apps/server/src/index.ts", name: "index.ts" }],
        }}
        actions={{
          onClose,
          onSelect: vi.fn(),
        }}
      />,
    );

    fireEvent.click(screen.getByLabelText("Close file candidate modal"));
    expect(onClose).toHaveBeenCalled();
  });
});
