import type { PartId } from "../geometry/part";
import { multiplyMatrices, type Mat4 } from "../math/mat4";
import type { Placement } from "../scene/assembly";
import type { Scene } from "../scene/scene";
import type { AssemblyOccurrenceId, PartOccurrenceId } from "../scene/types";
import type { PackedSceneRuntime, RuntimeInstanceInput } from "./runtime";

export interface AssemblyExpansionContext {
  readonly runtime: PackedSceneRuntime;
  readonly scene: Scene;
  readonly assemblyId: number;
  readonly nodeId: AssemblyOccurrenceId;
  readonly parent: number;
  readonly world: Mat4;
  readonly additions: RuntimeInstanceInput[];
  readonly resolvePartVisible: (partId: PartId, authoredVisible: boolean) => boolean;
  readonly resolveAssemblyVisible: (assemblyId: number, authoredVisible: boolean) => boolean;
  readonly addedNodes: number[];
}

/** Expands one newly introduced authored assembly subtree into reserved runtime slots. */
export function expandAssembly(context: AssemblyExpansionContext): void {
  const assembly = context.scene.assemblies.get(context.assemblyId);
  if (assembly === undefined) throw new Error(`Missing assembly ${context.assemblyId}`);
  const node = context.runtime.addAssemblyNode({
    nodeId: context.nodeId,
    assemblyId: context.assemblyId,
    parent: context.parent,
    worldTransform: context.world,
    assemblyVisible: context.resolveAssemblyVisible(
      context.assemblyId,
      context.scene.visibleAssemblyIds.has(context.assemblyId),
    ),
  });
  context.addedNodes.push(node);
  const children: number[] = [];
  for (const placement of assembly.placements) expandPlacement(context, node, children, placement);
  context.runtime.setNodeChildren(node, children);
}

function expandPlacement(
  context: AssemblyExpansionContext,
  node: number,
  children: number[],
  placement: Placement,
): void {
  const id = placement.placementId;
  if (id === undefined) {
    throw new Error(
      `AssemblyDefinition ${context.assemblyId} uses an implicit placement identity; migrate it before a live hierarchy edit`,
    );
  }
  const childId = `${context.nodeId}/${id}`;
  const world = multiplyMatrices(context.world, placement.transform);
  if (placement.kind === "part") {
    context.additions.push(
      hierarchyInstanceInput({ ...context, node, id: childId, placement, world }),
    );
    return;
  }
  expandAssembly({
    ...context,
    assemblyId: placement.assemblyId,
    nodeId: childId,
    parent: node,
    world,
  });
  const child = context.runtime.getNodeSlot(childId);
  if (child === undefined) throw new Error(`Missing added hierarchy child ${childId}`);
  children.push(child);
}

interface InstanceInputContext {
  readonly scene: Scene;
  readonly node: number;
  readonly id: PartOccurrenceId;
  readonly placement: Extract<Placement, { readonly kind: "part" }>;
  readonly world: Mat4;
  readonly resolvePartVisible: (partId: PartId, authoredVisible: boolean) => boolean;
  readonly overrideVisible?: boolean;
}

/** Resolves one new or retained part placement into the runtime's packed input contract. */
export function hierarchyInstanceInput(context: InstanceInputContext): RuntimeInstanceInput {
  return {
    instanceId: context.id,
    partId: context.placement.partId,
    owningNode: context.node,
    partVisible: context.resolvePartVisible(
      context.placement.partId,
      context.scene.visiblePartIds.has(context.placement.partId),
    ),
    overrideVisible: context.overrideVisible ?? true,
    worldTransform: context.world,
  };
}
