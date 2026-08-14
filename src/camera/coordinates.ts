/**
 * A point measured from the canvas's CSS content-box origin.
 * @category Camera and math
 */
export interface CanvasCssPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * An integer pixel in the canvas render target.
 * @category Camera and math
 */
export interface RenderPixel {
  readonly x: number;
  readonly y: number;
}

/**
 * Converts browser client coordinates to canvas-local CSS coordinates.
 * @category Camera and math
 */
export function clientToCanvasCss(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, "left" | "top">,
): CanvasCssPoint {
  return { x: clientX - rect.left, y: clientY - rect.top };
}

/**
 * Maps a canvas-local CSS point to the corresponding clamped render-target
 * pixel. CSS size and backing-store size are explicit so scaled canvases and
 * non-integer device pixel ratios follow the same path as GPU picking.
 * @category Camera and math
 */
export function canvasCssToRenderPixel(
  point: CanvasCssPoint,
  cssSize: { readonly width: number; readonly height: number },
  renderSize: { readonly width: number; readonly height: number },
): RenderPixel {
  const width = Math.max(1, renderSize.width);
  const height = Math.max(1, renderSize.height);
  const cssWidth = Math.max(Number.EPSILON, cssSize.width);
  const cssHeight = Math.max(Number.EPSILON, cssSize.height);
  return {
    x: clampPixel(Math.floor((point.x / cssWidth) * width), width),
    y: clampPixel(Math.floor((point.y / cssHeight) * height), height),
  };
}

function clampPixel(value: number, size: number): number {
  return Math.max(0, Math.min(size - 1, value));
}
