/** A minimal GPU canvas context for renderer tests. */
export function fakeCanvas(width = 800, height = 600): HTMLCanvasElement {
  const context = {
    configure: () => undefined,
    getCurrentTexture: () => ({ createView: () => ({}) }),
  };
  const canvas = {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    getContext: () => context,
    getBoundingClientRect: () => ({
      width: canvas.clientWidth,
      height: canvas.clientHeight,
      left: 0,
      top: 0,
    }),
    addEventListener: () => undefined,
    hasPointerCapture: () => false,
    setPointerCapture: () => undefined,
    releasePointerCapture: () => undefined,
  } as unknown as HTMLCanvasElement;
  return canvas;
}
