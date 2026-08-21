import type { InstanceSidecars } from "../resources/instance-storage";

/** Clones mutable sidecar descriptors while retaining their unchanged CPU/GPU backing. */
export function stagePartRevisionSidecars(sidecars: InstanceSidecars): InstanceSidecars {
  return {
    transparent: cloneSidecar(sidecars.transparent),
    selection: cloneSidecar(sidecars.selection),
    nodeSelection: cloneSidecar(sidecars.nodeSelection),
    nodeSelectionCompact: cloneSidecar(sidecars.nodeSelectionCompact),
    edge: cloneSidecar(sidecars.edge),
    node: cloneSidecar(sidecars.node),
  };
}

function cloneSidecar(sidecar: InstanceSidecars[keyof InstanceSidecars]) {
  return sidecar === undefined ? undefined : { ...sidecar };
}
