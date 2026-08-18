export const NODE_SELECTION_CAPTURE_EVENT = "femgx-benchmark-node-selection-captured";

const CAPTURE_TIMEOUT_MS = 30_000;

/** Holds the final selected frame until the opt-in browser lane captures it. */
export async function holdNodeSelectionCapture(canvas: HTMLCanvasElement): Promise<void> {
  canvas.dataset["benchmarkNodeSelection"] = "all";
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("Dense node-selection screenshot capture timed out"));
      }, CAPTURE_TIMEOUT_MS);
      const complete = (): void => {
        cleanup();
        resolve();
      };
      const cleanup = (): void => {
        window.clearTimeout(timeout);
        window.removeEventListener(NODE_SELECTION_CAPTURE_EVENT, complete);
      };
      window.addEventListener(NODE_SELECTION_CAPTURE_EVENT, complete, { once: true });
    });
  } finally {
    delete canvas.dataset["benchmarkNodeSelection"];
  }
}
