/** Returns Node's explicit collector when the benchmark lane enables it. */
export function exposedGc(): (() => void) | undefined {
  return (globalThis as { readonly gc?: () => void }).gc;
}

/** Forces one collection and records its wall-clock duration. */
export function forceGc(samples: number[]): void {
  const gc = exposedGc();
  if (gc === undefined) throw new Error("Heap evidence requires Node --expose-gc");
  const start = performance.now();
  gc();
  samples.push(performance.now() - start);
}
