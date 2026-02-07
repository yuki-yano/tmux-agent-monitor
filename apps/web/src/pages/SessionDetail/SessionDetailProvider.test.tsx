// @vitest-environment happy-dom
import { render, screen, waitFor } from "@testing-library/react";
import { useAtomValue } from "jotai";
import { describe, expect, it, vi } from "vitest";

import {
  connectedAtom,
  currentSessionAtom,
  paneIdAtom,
  resolvedThemeAtom,
  sessionApiAtom,
} from "./atoms/sessionDetailAtoms";
import { SessionDetailProvider } from "./SessionDetailProvider";
import { createSessionDetail } from "./test-helpers";

const mockSession = createSessionDetail({ paneId: "pane-1" });
const mockSessionsContext = {
  sessions: [mockSession],
  connected: true,
  connectionStatus: "healthy",
  connectionIssue: null,
  highlightCorrections: { codex: false, claude: true },
  reconnect: vi.fn(),
  refreshSessions: vi.fn(),
  requestDiffSummary: vi.fn(),
  requestDiffFile: vi.fn(),
  requestCommitLog: vi.fn(),
  requestCommitDetail: vi.fn(),
  requestCommitFile: vi.fn(),
  requestStateTimeline: vi.fn(),
  requestScreen: vi.fn(),
  focusPane: vi.fn(),
  uploadImageAttachment: vi.fn(),
  sendText: vi.fn(),
  sendKeys: vi.fn(),
  sendRaw: vi.fn(),
  touchSession: vi.fn(),
  updateSessionTitle: vi.fn(),
  getSessionDetail: vi.fn(),
};

vi.mock("@/state/session-context", () => ({
  useSessions: () => mockSessionsContext,
}));

vi.mock("@/state/theme-context", () => ({
  useTheme: () => ({
    preference: "system",
    resolvedTheme: "mocha",
    setPreference: vi.fn(),
  }),
}));

const TestConsumer = () => {
  const paneId = useAtomValue(paneIdAtom);
  const connected = useAtomValue(connectedAtom);
  const session = useAtomValue(currentSessionAtom);
  const theme = useAtomValue(resolvedThemeAtom);
  const api = useAtomValue(sessionApiAtom);

  return (
    <div>
      <div data-testid="pane-id">{paneId ?? ""}</div>
      <div data-testid="connected">{connected ? "true" : "false"}</div>
      <div data-testid="session-id">{session?.paneId ?? ""}</div>
      <div data-testid="theme">{theme}</div>
      <div data-testid="api">{api ? "ready" : "missing"}</div>
    </div>
  );
};

describe("SessionDetailProvider", () => {
  it("hydrates atoms from session context and theme", async () => {
    render(
      <SessionDetailProvider paneId="pane-1">
        <TestConsumer />
      </SessionDetailProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("pane-id").textContent).toBe("pane-1");
    });
    expect(screen.getByTestId("connected").textContent).toBe("true");
    expect(screen.getByTestId("session-id").textContent).toBe("pane-1");
    expect(screen.getByTestId("theme").textContent).toBe("mocha");
    expect(screen.getByTestId("api").textContent).toBe("ready");
  });
});
