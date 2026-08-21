import { describe, expect, it } from "vitest";
import { setElementVisible } from "@/interaction/elements";
import { setTargetSelected } from "@/interaction/targets";
import {
  createPart,
  createResultField,
  createViewport,
  explicitScene,
  fakeCanvas,
  fakeGpuDevice,
  installNavigator,
  installTestGpuGlobals,
  translationMatrix,
  type Part,
} from "./support";

describe("Viewport atomic part revision staging", () => {
  it("keeps live resources intact when staged optional allocations fail", async () => {
    for (const scenario of [
      { label: "femgx orientation glyph normals", nextInteraction: unchangedInteraction },
      { label: "femgx orientation glyph records", nextInteraction: unchangedInteraction },
      { label: "femgx orientation glyph order", nextInteraction: unchangedInteraction },
      { label: "femgx result color storage", nextInteraction: unchangedInteraction },
      {
        label: "femgx element highlight storage",
        nextInteraction: (viewport: Awaited<ReturnType<typeof fixture>>) =>
          setTargetSelected(
            viewport.interaction.state,
            { kind: "element" as const, partOccurrenceId: "1/revised", elementId: 0 },
            true,
          ),
      },
      {
        label: "femgx selection order",
        nextInteraction: (viewport: Awaited<ReturnType<typeof fixture>>) =>
          setTargetSelected(
            viewport.interaction.state,
            { kind: "element" as const, partOccurrenceId: "1/revised", elementId: 0 },
            true,
          ),
      },
      {
        label: "femgx visibility skin",
        nextInteraction: (viewport: Awaited<ReturnType<typeof fixture>>) =>
          setElementVisible(
            viewport.interaction.state,
            { partOccurrenceId: "1/revised", elementId: 0 },
            false,
          ),
      },
    ]) {
      installTestGpuGlobals();
      installNavigator();
      let fail = false;
      const gpu = fakeGpuDevice({
        onCreateBuffer: (_creation, descriptor) => {
          if (fail && descriptor.label === scenario.label)
            throw new Error(`failed staged ${scenario.label}`);
        },
      });
      const viewport = await fixture(gpu.device);
      const draw = rendererDraw(viewport);
      const original = viewport.scene.parts.get(1);
      const storage = draw.storages.get(1);
      const geometry = draw.primitiveParts.get(1)?.get("triangles");
      const color = draw.resultColors.get(1)?.buffer;
      const deformation = draw.deformations.get(1)?.buffer;
      const glyph = draw.orientationGlyphs.parts.get(1)?.groups.get(1)?.recordBuffer;
      const bindGroup = storage?.bindGroup;
      const bufferStart = gpu.buffers.length;
      const writeStart = gpu.writes.length;
      fail = true;

      const update = () => {
        const renderer = rendererInternals(viewport);
        const parts = new Map(viewport.scene.parts);
        parts.set(1, resultQuadPart(1, 2));
        renderer.attachment.replaceParts(
          parts,
          new Set([1]),
          scenario.nextInteraction(viewport),
          renderer.lifecycle.bundle,
          renderer.results,
        );
      };
      expect(update).toThrow(`failed staged ${scenario.label}`);

      expect(viewport.scene.parts.get(1)).toBe(original);
      expect(draw.storages.get(1)).toBe(storage);
      expect(draw.storages.get(1)?.bindGroup).toBe(bindGroup);
      expect(draw.primitiveParts.get(1)?.get("triangles")).toBe(geometry);
      expect(draw.resultColors.get(1)?.buffer).toBe(color);
      expect(draw.deformations.get(1)?.buffer).toBe(deformation);
      expect(draw.orientationGlyphs.parts.get(1)?.groups.get(1)?.recordBuffer).toBe(glyph);
      const destroys = gpu.buffers.slice(bufferStart).map((buffer) => buffer.destroyCount);
      expect(destroys).toEqual(gpu.buffers.slice(bufferStart).map(() => 1));
      expect(
        gpu.writes
          .slice(writeStart)
          .some((write) =>
            [storage?.buffer, storage?.orderBuffer, color, deformation, glyph].includes(
              write.buffer,
            ),
          ),
      ).toBe(false);
      expect(() => {
        viewport.render();
      }).not.toThrow();
      viewport.destroy();
    }
  });
});

function unchangedInteraction(viewport: Awaited<ReturnType<typeof fixture>>) {
  return viewport.interaction.state;
}

async function fixture(device: GPUDevice) {
  const viewport = await createViewport({
    canvas: fakeCanvas(),
    scene: explicitScene(
      [resultQuadPart(1, 1)],
      [{ kind: "part", placementId: "revised", partId: 1, transform: translationMatrix(0, 0, 0) }],
    ),
    device,
    results: resultRoles(),
  });
  viewport.render();
  return viewport;
}

function resultQuadPart(id: number, extent: number): Part {
  return createPart(id, {
    nodePositions: new Float32Array([0, 0, 0, extent, 0, 0, 0, extent, 0, extent, extent, 0]),
    elements: [
      {
        id: 0,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }],
      },
      {
        id: 1,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 1, primitiveCount: 1 }],
      },
    ],
    geometries: [
      {
        primitive: "triangles",
        positions: new Float32Array([0, 0, 0, extent, 0, 0, 0, extent, 0, extent, extent, 0]),
        indices: new Uint32Array([0, 1, 2, 1, 3, 2]),
        nodePickIds: new Uint32Array([1, 2, 3, 4]),
        faces: [
          {
            elementId: 0,
            faceIndex: 0,
            primitiveStart: 0,
            primitiveCount: 1,
            key: "0/1/2",
            nodeIds: [0, 1, 2],
          },
          {
            elementId: 1,
            faceIndex: 0,
            primitiveStart: 1,
            primitiveCount: 1,
            key: "1/3/2",
            nodeIds: [1, 3, 2],
          },
        ],
      },
    ],
  });
}

function resultRoles() {
  return {
    scalar: {
      field: createResultField({
        id: "scalar",
        name: "scalar",
        location: "nodal",
        shape: "scalar",
        count: 4,
        unit: "source",
        values: new Float32Array([1, 2, 3, 4]),
      }),
    },
    deformation: {
      field: createResultField({
        id: "deformation",
        name: "deformation",
        location: "nodal",
        shape: "vector",
        count: 4,
        unit: "source",
        values: new Float32Array(12),
      }),
    },
    orientation: {
      field: createResultField({
        id: "orientation",
        name: "orientation",
        location: "elemental",
        shape: "vector",
        count: 2,
        unit: "source",
        values: new Float32Array([1, 0, 0, 1, 0, 0]),
      }),
      glyph: "arrow" as const,
      transform: "direction" as const,
    },
  };
}

function rendererDraw(viewport: Awaited<ReturnType<typeof fixture>>) {
  const owner = rendererInternals(viewport);
  return (owner.lifecycle.bundle as { readonly draw: unknown }).draw as {
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
    };
  };
}

function rendererInternals(viewport: Awaited<ReturnType<typeof fixture>>) {
  const owner = viewport as unknown as {
    readonly renderer: {
      readonly attachment: {
        replaceParts: (
          parts: ReadonlyMap<number, Part>,
          partIds: ReadonlySet<number>,
          interaction: typeof viewport.interaction.state,
          bundle: unknown,
          results: unknown,
        ) => void;
      };
      readonly lifecycle: { readonly bundle: unknown };
      readonly deformation: unknown;
      readonly resultColors: unknown;
      readonly orientationGlyphs: unknown;
    };
  };
  const renderer = owner.renderer;
  return {
    ...renderer,
    results: {
      deformation: renderer.deformation,
      colors: renderer.resultColors,
      glyphs: renderer.orientationGlyphs,
      staged: {
        deformation: renderer.deformation,
        colors: renderer.resultColors,
        glyphs: renderer.orientationGlyphs,
      },
    },
  };
}
