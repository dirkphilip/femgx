import {
  createPartFromElementModel,
  createElement,
  createElementModel,
  ElementShape,
} from "@/entries/model";
import { translationMatrix, type Bounds, type PartId, type Scene } from "@/entries/root";
import type { ExplicitPlacement, SceneUpdate } from "@/entries/root";
import { sceneBounds } from "../scene-bounds";
import type { WorkbenchModel } from "./models/model";

export const MAX_LIVE_PART_COPIES = 100_000;

export interface LivePartRequest {
  readonly kind: "add" | "instance";
  readonly partId?: PartId;
  readonly copies: number;
  readonly spacing: number;
}

export interface PreparedLivePartEdit {
  readonly request: LivePartRequest;
  readonly partId: PartId;
  readonly part: ReturnType<typeof createPartFromElementModel> | undefined;
  readonly elementModel: ReturnType<typeof createElementModel> | undefined;
  readonly placements: readonly ExplicitPlacement[];
  readonly apply: (update: SceneUpdate) => void;
  modelAfter(scene: Scene): WorkbenchModel;
}

/** Validates the bounded, demo-only dialog values before any scene mutation. */
export function parseLivePartRequest(
  kind: LivePartRequest["kind"],
  partId: PartId | undefined,
  copies: string,
  spacing: string,
): LivePartRequest | undefined {
  const count = Number(copies);
  const gap = Number(spacing);
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_LIVE_PART_COPIES) return undefined;
  if (!Number.isFinite(gap) || gap <= 0 || gap > 1_000_000) return undefined;
  if (kind === "instance" && partId === undefined) return undefined;
  return { kind, ...(partId === undefined ? {} : { partId }), copies: count, spacing: gap };
}

/** Prebuilds one immutable box part and all root placements outside the scene transaction. */
export function prepareLivePartEdit(
  model: WorkbenchModel,
  request: LivePartRequest,
): PreparedLivePartEdit {
  const partId = request.kind === "add" ? nextPartId(model.scene) : requiredPartId(request);
  const elementModel = request.kind === "add" ? builtInBoxModel() : undefined;
  const part =
    elementModel === undefined ? undefined : createPartFromElementModel(partId, elementModel);
  const placements = gridPlacements(
    model.scene,
    model.bounds,
    partId,
    request.copies,
    request.spacing,
  );
  return {
    request,
    partId,
    part,
    elementModel,
    placements,
    apply: (update): void => {
      if (part !== undefined) update.addPart(part);
      for (const placement of placements)
        update.addPlacement(model.scene.rootAssemblyId, placement);
    },
    modelAfter(scene): WorkbenchModel {
      const partNames = new Map(model.partNames);
      const partStyles = new Map(model.partStyles);
      const elementModels = new Map(model.elementModels);
      if (part !== undefined && elementModel !== undefined) {
        partNames.set(partId, "Live Hex8 box");
        partStyles.set(partId, { color: { r: 0.18, g: 0.62, b: 0.92, a: 1 } });
        elementModels.set(partId, elementModel);
      }
      return {
        ...model,
        scene,
        partNames,
        partStyles,
        elementModels,
        bounds: sceneBounds(scene),
      };
    },
  };
}

function requiredPartId(request: LivePartRequest): PartId {
  if (request.partId === undefined) throw new Error("Instance request requires a source part");
  return request.partId;
}

function nextPartId(scene: Scene): PartId {
  let id = 1;
  while (scene.parts.has(id)) id += 1;
  return id;
}

function builtInBoxModel(): ReturnType<typeof createElementModel> {
  return createElementModel(
    [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1],
    [createElement(1, ElementShape.Hex8, [0, 1, 2, 3, 4, 5, 6, 7])],
  );
}

function gridPlacements(
  scene: Scene,
  bounds: Bounds,
  partId: PartId,
  copies: number,
  spacing: number,
): readonly ExplicitPlacement[] {
  const used = new Set(
    scene.assemblies.get(scene.rootAssemblyId)?.placements.map(placementId) ?? [],
  );
  const columns = Math.ceil(Math.sqrt(copies));
  const step = 1 + spacing;
  const startX = bounds.maxX + spacing;
  const startZ = bounds.minZ;
  const placements: ExplicitPlacement[] = [];
  for (let index = 0; index < copies; index += 1) {
    const placementId = uniquePlacementId(used, `live-${partId}-${index + 1}`);
    const column = index % columns;
    const row = Math.floor(index / columns);
    placements.push({
      kind: "part",
      placementId,
      partId,
      transform: translationMatrix(startX + column * step, bounds.minY, startZ + row * step),
    });
  }
  return placements;
}

function placementId(placement: { readonly placementId?: string }, index: number): string {
  return placement.placementId ?? String(index);
}

function uniquePlacementId(used: Set<string>, candidate: string): string {
  let value = candidate;
  let suffix = 1;
  while (used.has(value)) value = `${candidate}-${suffix++}`;
  used.add(value);
  return value;
}
