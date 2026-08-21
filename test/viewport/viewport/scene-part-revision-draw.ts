import type { Viewport } from "@/viewport/types";

export interface PartRevisionDraw {
  readonly storages: ReadonlyMap<
    number,
    {
      readonly buffer: GPUBuffer;
      readonly orderBuffer: GPUBuffer;
      readonly bindGroup: GPUBindGroup | undefined;
    }
  >;
  readonly primitiveParts: ReadonlyMap<number, ReadonlyMap<"triangles", unknown>>;
  readonly resultColors: ReadonlyMap<number, { readonly buffer: GPUBuffer }>;
  readonly deformations: ReadonlyMap<number, { readonly buffer: GPUBuffer }>;
  readonly orientationGlyphs: {
    readonly parts: ReadonlyMap<
      number,
      { readonly groups: ReadonlyMap<number, { readonly recordBuffer: GPUBuffer }> }
    >;
    readonly paramsBuffer: GPUBuffer | undefined;
  };
}

/** Reads renderer-owned resources used by the revision transaction regression suite. */
export function partRevisionDraw(viewport: Viewport): PartRevisionDraw {
  const owner = viewport as unknown as {
    readonly renderer: { readonly lifecycle: { readonly bundle: { readonly draw: unknown } } };
  };
  return owner.renderer.lifecycle.bundle.draw as PartRevisionDraw;
}
