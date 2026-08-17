/** Defines the WebGPU numeric constants the renderer source references. */
export function installGpuGlobals(): () => void {
  const originals = new Map<string, unknown>();
  const define = (name: string, value: unknown): void => {
    originals.set(name, (globalThis as Record<string, unknown>)[name]);
    Object.defineProperty(globalThis, name, { configurable: true, value });
  };
  define("GPUShaderStage", { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 });
  define("GPUBufferUsage", {
    UNIFORM: 1,
    COPY_DST: 2,
    VERTEX: 4,
    INDEX: 8,
    STORAGE: 16,
    MAP_READ: 32,
    COPY_SRC: 64,
    QUERY_RESOLVE: 128,
  });
  define("GPUTextureUsage", { RENDER_ATTACHMENT: 1, COPY_SRC: 2, TEXTURE_BINDING: 4 });
  define("GPUMapMode", { READ: 1 });
  define("devicePixelRatio", 1);
  return () => {
    for (const [name, value] of originals) {
      Object.defineProperty(globalThis, name, { configurable: true, value });
    }
  };
}
