import { type Locator } from "@playwright/test";

/** One screenshot's deterministic hash and distinct-color count. */
export async function pixelMetrics(canvas: Locator): Promise<{
  readonly distinctColors: number;
  readonly saturatedPixels: number;
  readonly orangePixels: number;
  readonly hash: string;
}> {
  const encoded = (await canvas.screenshot()).toString("base64");
  return canvas.page().evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const blob = new Blob([bytes], { type: "image/png" });
    const bitmap = await createImageBitmap(blob);
    const snapshot = document.createElement("canvas");
    snapshot.width = bitmap.width;
    snapshot.height = bitmap.height;
    const context = snapshot.getContext("2d");
    if (context === null) throw new Error("no 2d snapshot context for pixel decode");
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    bitmap.close();

    let hash = 0;
    let saturatedPixels = 0;
    let orangePixels = 0;
    const colors = new Set<number>();
    for (let index = 0; index < data.length; index += 4) {
      const red = data[index] ?? 0;
      const green = data[index + 1] ?? 0;
      const blue = data[index + 2] ?? 0;
      const alpha = data[index + 3] ?? 0;
      hash = ((hash * 31 + red) * 31 + green * 7 + blue * 3 + alpha) >>> 0;
      colors.add((red << 16) | (green << 8) | blue);
      if (Math.max(red, green, blue) - Math.min(red, green, blue) >= 64) saturatedPixels += 1;
      if (red >= 200 && green >= 60 && green <= 190 && blue <= 80) orangePixels += 1;
    }
    return { distinctColors: colors.size, saturatedPixels, orangePixels, hash: hash.toString(16) };
  }, encoded);
}

/** True when the canvas has actually drawn something (more than one color). */
export async function drawnPixels(canvas: Locator): Promise<boolean> {
  return (await distinctColors(canvas)) > 1;
}

/** A deterministic fingerprint of the presented canvas pixels. */
export async function pixelHash(canvas: Locator): Promise<string> {
  return (await pixelMetrics(canvas)).hash;
}

/** The number of distinct RGB colors in the presented canvas. */
export async function distinctColors(canvas: Locator): Promise<number> {
  return (await pixelMetrics(canvas)).distinctColors;
}
