import { type Locator } from "@playwright/test";

export type Box = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** Canvas pixels not covered by the workbench's full-width HUD chrome. */
export async function canvasInteractionBox(canvas: Locator): Promise<Box> {
  return canvas.evaluate((element: HTMLCanvasElement) => {
    const canvasBounds = element.getBoundingClientRect();
    let top = canvasBounds.top;
    let bottom = canvasBounds.bottom;
    const centerX = (canvasBounds.left + canvasBounds.right) / 2;
    const overlays = element.parentElement?.querySelectorAll<HTMLElement>(
      ".toolbar, .renderer-alert, .status-alert",
    );
    for (const overlay of overlays ?? []) {
      if (overlay.hidden || getComputedStyle(overlay).display === "none") continue;
      const bounds = overlay.getBoundingClientRect();
      if (bounds.width === 0 || bounds.height === 0) continue;
      if (centerX < bounds.left || centerX > bounds.right) continue;
      if (bounds.bottom <= canvasBounds.top || bounds.top >= canvasBounds.bottom) continue;
      const centerY = (bounds.top + bounds.bottom) / 2;
      if (centerY < canvasBounds.top + canvasBounds.height / 2) {
        top = Math.max(top, bounds.bottom);
      } else {
        bottom = Math.min(bottom, bounds.top);
      }
    }
    if (bottom - top < 16) throw new Error("canvas has no exposed interaction area");
    return {
      x: canvasBounds.left,
      y: top,
      width: canvasBounds.width,
      height: bottom - top,
    };
  });
}
