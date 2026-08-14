/**
 * A GPU pick copy or map failure after rendering has already succeeded.
 * @category Advanced runtime and WebGPU platform
 */
export class WebGpuPickReadbackError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WebGpuPickReadbackError";
  }
}
