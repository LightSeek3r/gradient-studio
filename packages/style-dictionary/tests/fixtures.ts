// Token fixtures shared by the build tests. Colour objects use the DTCG 2025.10 shape.
export const srgb = (r: number, g: number, b: number, alpha = 1) => ({ colorSpace: "srgb", components: [r, g, b], alpha });
const hexObj = (hex: string) => {
  const c = (i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  return srgb(c(0), c(1), c(2));
};
export const stop = (hex: string, position?: number) => ({ color: hexObj(hex), ...(position === undefined ? {} : { position }) });

export const RGB_STOPS = [stop("#ff0000", 0), stop("#00ff00", 0.5), stop("#0000ff", 1)];
export const NAVY_STOPS = [stop("#101b45", 0), stop("#eeeeee", 0.3), stop("#202040", 1)];
export const SMOOTH_STOPS = [stop("#101b45", 0), stop("#9333ea", 1)];
