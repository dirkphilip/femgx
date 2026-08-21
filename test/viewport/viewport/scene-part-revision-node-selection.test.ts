import { describe, expect, it } from "vitest";
import { setElementVisible } from "@/interaction/elements";
import { setTargetSelected } from "@/interaction/targets";
import {
  createPart,
  createViewport,
  explicitScene,
  fakeCanvas,
  fakeGpuDevice,
  installNavigator,
  installTestGpuGlobals,
  translationMatrix,
  type Part,
} from "./support";

describe("Viewport part revision selected-node staging", () => {
  it("retains the live compact selected-node order when a later staged allocation fails", async () => {
    installTestGpuGlobals();
    installNavigator();
    let fail = false;
    const gpu = fakeGpuDevice({
      onCreateBuffer: (_creation, descriptor) => {
        if (fail && descriptor.label === "femgx visibility skin") {
          throw new Error("failed staged visibility skin");
        }
      },
    });
    const viewport = await nodeViewport(gpu.device, [0, 1]);
    const renderer = rendererInternals(viewport);
    const draw = rendererDraw(renderer);
    const storage = draw.storages.get(1);
    const compact = storage?.sidecars.nodeSelectionCompact;
    if (compact === undefined) throw new Error("live compact selected-node order is missing");
    const oldData = compact.data.slice();
    const bufferStart = gpu.buffers.length;
    const writeStart = gpu.writes.length;
    const next = setElementVisible(
      setTargetSelected(
        setTargetSelected(viewport.interaction.state, nodeTarget(0), false),
        nodeTarget(2),
        true,
      ),
      { partOccurrenceId: "1/revised", elementId: 0 },
      false,
    );
    fail = true;

    expect(() => {
      replacePart(renderer, viewport, next);
    }).toThrow("failed staged visibility skin");

    expect(draw.storages.get(1)).toBe(storage);
    expect(draw.storages.get(1)?.sidecars.nodeSelectionCompact).toBe(compact);
    expect(compact.data).toEqual(oldData);
    expect(gpu.writes.slice(writeStart).some((write) => write.buffer === compact.buffer)).toBe(
      false,
    );
    expect(gpu.buffers.slice(bufferStart).map((buffer) => buffer.destroyCount)).toEqual(
      gpu.buffers.slice(bufferStart).map(() => 1),
    );
    expect(() => {
      viewport.render();
    }).not.toThrow();
    viewport.destroy();
  });

  it("commits a grown compact selected-node order and retires only its prior buffer", async () => {
    installTestGpuGlobals();
    installNavigator();
    const gpu = fakeGpuDevice();
    const viewport = await nodeViewport(gpu.device, [0]);
    const renderer = rendererInternals(viewport);
    const draw = rendererDraw(renderer);
    const storage = draw.storages.get(1);
    const previous = storage?.sidecars.nodeSelectionCompact;
    if (previous === undefined) throw new Error("live compact selected-node order is missing");
    const writeStart = gpu.writes.length;
    const next = setTargetSelected(viewport.interaction.state, nodeTarget(1), true);

    replacePart(renderer, viewport, next);

    const current = draw.storages.get(1)?.sidecars.nodeSelectionCompact;
    if (current === undefined) throw new Error("grown compact selected-node order is missing");
    expect(draw.storages.get(1)).toBe(storage);
    expect(current).not.toBe(previous);
    expect(current.data.subarray(0, current.length)).toEqual(new Uint32Array([0, 0, 0, 1]));
    expect(gpu.buffers.find((buffer) => buffer.resource === previous.buffer)?.destroyCount).toBe(1);
    expect(gpu.buffers.find((buffer) => buffer.resource === current.buffer)?.destroyCount).toBe(0);
    expect(gpu.writes.slice(writeStart).some((write) => write.buffer === current.buffer)).toBe(
      true,
    );
    expect(gpu.writes.slice(writeStart).some((write) => write.buffer === previous.buffer)).toBe(
      false,
    );
    viewport.destroy();
  });
});

async function nodeViewport(device: GPUDevice, nodeIds: readonly number[]) {
  const viewport = await createViewport({
    canvas: fakeCanvas(),
    scene: explicitScene(
      [nodePart(1, 1)],
      [{ kind: "part", placementId: "revised", partId: 1, transform: translationMatrix(0, 0, 0) }],
    ),
    device,
  });
  let interaction = viewport.interaction.state;
  for (const nodeId of nodeIds)
    interaction = setTargetSelected(interaction, nodeTarget(nodeId), true);
  viewport.interaction.set(interaction);
  viewport.render();
  return viewport;
}

function replacePart(
  renderer: ReturnType<typeof rendererInternals>,
  viewport: Awaited<ReturnType<typeof nodeViewport>>,
  interaction: typeof viewport.interaction.state,
): void {
  const parts = new Map(viewport.scene.parts);
  parts.set(1, nodePart(1, 2));
  renderer.attachment.replaceParts(parts, new Set([1]), interaction, renderer.lifecycle.bundle);
}

function nodeTarget(nodeId: number) {
  return { kind: "node" as const, partOccurrenceId: "1/revised", nodeId };
}

function nodePart(id: number, extent: number): Part {
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

function rendererInternals(viewport: Awaited<ReturnType<typeof nodeViewport>>) {
  return (
    viewport as unknown as {
      readonly renderer: {
        readonly attachment: {
          replaceParts: (
            parts: ReadonlyMap<number, Part>,
            partIds: ReadonlySet<number>,
            interaction: typeof viewport.interaction.state,
            bundle: unknown,
          ) => void;
        };
        readonly lifecycle: { readonly bundle: unknown };
      };
    }
  ).renderer;
}

function rendererDraw(renderer: ReturnType<typeof rendererInternals>) {
  return (renderer.lifecycle.bundle as { readonly draw: unknown }).draw as {
    readonly storages: ReadonlyMap<
      number,
      {
        readonly sidecars: {
          readonly nodeSelectionCompact:
            | { readonly buffer: GPUBuffer; readonly data: Uint32Array; readonly length: number }
            | undefined;
        };
      }
    >;
  };
}
