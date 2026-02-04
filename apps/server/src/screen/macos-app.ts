export type TerminalBackend = "alacritty" | "terminal" | "iterm" | "wezterm" | "ghostty";

type TerminalApp = {
  key: TerminalBackend;
  appName: string;
};

const terminalCandidates: readonly TerminalApp[] = [
  { key: "alacritty", appName: "Alacritty" },
  { key: "terminal", appName: "Terminal" },
  { key: "iterm", appName: "iTerm2" },
  { key: "wezterm", appName: "WezTerm" },
  { key: "ghostty", appName: "Ghostty" },
];

export const resolveBackendApp = (backend: TerminalBackend) =>
  terminalCandidates.find((candidate) => candidate.key === backend) ?? null;
