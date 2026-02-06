import type { PaneGeometry } from "./tmux-geometry.js";

export const cropPaneBounds = (
  base: { x: number; y: number; width: number; height: number },
  geometry: PaneGeometry,
) => {
  if (
    geometry.left < 0 ||
    geometry.top < 0 ||
    geometry.width <= 0 ||
    geometry.height <= 0 ||
    geometry.windowWidth <= 0 ||
    geometry.windowHeight <= 0
  ) {
    return null;
  }
  if (
    geometry.left + geometry.width > geometry.windowWidth ||
    geometry.top + geometry.height > geometry.windowHeight
  ) {
    return null;
  }
  const cellWidth = base.width / geometry.windowWidth;
  const cellHeight = base.height / geometry.windowHeight;
  const x = Math.round(base.x + geometry.left * cellWidth);
  const y = Math.round(base.y + geometry.top * cellHeight);
  const width = Math.round(geometry.width * cellWidth);
  const height = Math.round(geometry.height * cellHeight);
  if (width <= 0 || height <= 0) {
    return null;
  }
  return { x, y, width, height };
};
