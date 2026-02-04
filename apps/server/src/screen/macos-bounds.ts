export type Bounds = { x: number; y: number; width: number; height: number };

const parseBounds = (input: string): Bounds | null => {
  const parts = input
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => !Number.isNaN(value));
  if (parts.length !== 4) {
    return null;
  }
  const [x, y, width, height] = parts;
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return null;
  }
  return { x, y, width, height };
};

export const buildTerminalBoundsScript = (appName: string) => `
tell application "System Events"
  if not (exists process "${appName}") then return ""
  tell process "${appName}"
    try
      set windowFrame to value of attribute "AXFrame" of front window
      set pos to {item 1 of windowFrame, item 2 of windowFrame}
      set sz to {item 3 of windowFrame, item 4 of windowFrame}
      set contentPos to pos
      set contentSize to sz
      try
        set scrollArea to first UI element of front window whose role is "AXScrollArea"
        set contentFrame to value of attribute "AXFrame" of scrollArea
        set contentPos to {item 1 of contentFrame, item 2 of contentFrame}
        set contentSize to {item 3 of contentFrame, item 4 of contentFrame}
      end try
      return (item 1 of contentPos as text) & ", " & (item 2 of contentPos as text) & ", " & (item 1 of contentSize as text) & ", " & (item 2 of contentSize as text) & "|" & (item 1 of pos as text) & ", " & (item 2 of pos as text) & ", " & (item 1 of sz as text) & ", " & (item 2 of sz as text)
    end try
  end tell
end tell
return ""
`;

export const parseBoundsSet = (input: string) => {
  const [contentRaw, windowRaw] = input.split("|").map((part) => part.trim());
  const content = contentRaw ? parseBounds(contentRaw) : null;
  const window = windowRaw ? parseBounds(windowRaw) : null;
  return { content, window: window ?? content };
};
