export type BenchmarkCapture = "node-selection" | "combined-overlay";

/** Event released by the opt-in visual lane after it captures a held benchmark frame. */
export function benchmarkCaptureEvent(capture: BenchmarkCapture): string {
  return `femgx-benchmark-${capture}-captured`;
}

const CAPTURE_TIMEOUT_MS = 30_000;

/** Holds the final selected frame until the opt-in browser lane captures it. */
export async function holdBenchmarkCapture(
  canvas: HTMLCanvasElement,
  capture: BenchmarkCapture,
): Promise<void> {
  canvas.dataset["benchmarkCapture"] = capture;
  const event = benchmarkCaptureEvent(capture);
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error(`${capture} screenshot capture timed out`));
      }, CAPTURE_TIMEOUT_MS);
      const complete = (): void => {
        cleanup();
        resolve();
      };
      const cleanup = (): void => {
        window.clearTimeout(timeout);
        window.removeEventListener(event, complete);
      };
      window.addEventListener(event, complete, { once: true });
    });
  } finally {
    delete canvas.dataset["benchmarkCapture"];
  }
}
