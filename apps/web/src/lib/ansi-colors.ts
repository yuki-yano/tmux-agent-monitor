export type Rgb = [number, number, number];

export const parseColor = (value: string | null): Rgb | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.startsWith("#")) {
    const hex = trimmed.slice(1);
    if (hex.length === 3) {
      const rHex = hex[0] ?? "0";
      const gHex = hex[1] ?? "0";
      const bHex = hex[2] ?? "0";
      const r = Number.parseInt(rHex + rHex, 16);
      const g = Number.parseInt(gHex + gHex, 16);
      const b = Number.parseInt(bHex + bHex, 16);
      return [r, g, b];
    }
    if (hex.length === 6) {
      const r = Number.parseInt(hex.slice(0, 2) || "00", 16);
      const g = Number.parseInt(hex.slice(2, 4) || "00", 16);
      const b = Number.parseInt(hex.slice(4, 6) || "00", 16);
      return [r, g, b];
    }
    return null;
  }
  const rgbMatch = trimmed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!rgbMatch) return null;
  return [
    Number.parseInt(rgbMatch[1] ?? "0", 10),
    Number.parseInt(rgbMatch[2] ?? "0", 10),
    Number.parseInt(rgbMatch[3] ?? "0", 10),
  ];
};

export const luminance = (rgb: Rgb) => {
  const toLinear = (value: number) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = rgb;
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
};

export const contrastRatio = (a: Rgb, b: Rgb) => {
  const lumA = luminance(a);
  const lumB = luminance(b);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
};

export const blendRgb = (from: Rgb, to: Rgb, ratio: number): Rgb => {
  const safeRatio = Math.min(1, Math.max(0, ratio));
  const mix = (value: number, target: number) =>
    Math.round(value * (1 - safeRatio) + target * safeRatio);
  return [mix(from[0], to[0]), mix(from[1], to[1]), mix(from[2], to[2])];
};
