/** A GPU pick copy or map failure after rendering has already succeeded. */
export class WebGpuPickReadbackError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WebGpuPickReadbackError";
  }
}
