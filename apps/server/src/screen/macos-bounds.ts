export type Bounds = { x: number; y: number; width: number; height: number };
export type BoundsSet = { content: Bounds | null; window: Bounds | null };

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
  if (width <= 0 || height <= 0) {
    return null;
  }
  return { x, y, width, height };
};

export const buildTerminalBoundsScript = (appName: string) => `
tell application "System Events"
  if not (exists process "${appName}") then return ""
  tell process "${appName}"
    try
      set windowPos to value of attribute "AXPosition" of front window
      set windowSize to value of attribute "AXSize" of front window
      set contentPos to windowPos
      set contentSize to windowSize
      try
        set scrollArea to first UI element of front window whose role is "AXScrollArea"
        set contentPos to value of attribute "AXPosition" of scrollArea
        set contentSize to value of attribute "AXSize" of scrollArea
      end try
      return (item 1 of contentPos as text) & ", " & (item 2 of contentPos as text) & ", " & (item 1 of contentSize as text) & ", " & (item 2 of contentSize as text) & "|" & (item 1 of windowPos as text) & ", " & (item 2 of windowPos as text) & ", " & (item 1 of windowSize as text) & ", " & (item 2 of windowSize as text)
    end try
  end tell
end tell
return ""
`;

export const parseBoundsSet = (input: string): BoundsSet => {
  const [contentRaw, windowRaw] = input.split("|").map((part) => part.trim());
  const content = contentRaw ? parseBounds(contentRaw) : null;
  const window = windowRaw ? parseBounds(windowRaw) : null;
  return { content, window: window ?? content };
};
