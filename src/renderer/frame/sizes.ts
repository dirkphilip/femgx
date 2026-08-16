/** Converts a CSS-pixel point diameter into device pixels. */
export function pointSizeDevicePixels(cssPixels: number, dpr = devicePixelRatio): number {
  return Math.max(1, cssPixels * dpr);
}

/** Converts a CSS-pixel node diameter into device pixels. */
export function nodeSizeDevicePixels(cssPixels: number, dpr = devicePixelRatio): number {
  return Math.max(1, cssPixels * dpr);
}
