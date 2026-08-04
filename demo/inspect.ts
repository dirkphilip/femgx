import type { ResolvedPick } from "../src/index";

/** Formats the world-space hit data of a resolved pick for the inspection panel. */
export function describePick(hit: ResolvedPick | undefined): string {
  if (hit === undefined) {
    return "Click or right-click a visible element, face, or node to inspect it.";
  }
  const position = formatVec(hit.position);
  if (hit.kind === "node") {
    const adjacency =
      hit.adjacentElementIds.length === 0 ? "none" : hit.adjacentElementIds.join(", ");
    return (
      `Node ${hit.nodeId}\n` +
      `Part ${hit.partId} · Instance ${hit.instanceId}\n` +
      `Position ${position}\n` +
      `Adjacent elements ${adjacency}\n` +
      `Neighbors ${hit.adjacentNodeIds.length}`
    );
  }
  if (hit.kind === "face") {
    const owners = hit.adjacentElementIds.join(", ");
    return (
      `Face ${hit.faceKey}\n` +
      `Element ${hit.elementId} · Part ${hit.partId} · Instance ${hit.instanceId}\n` +
      `Normal ${formatVec(hit.normal)}\n` +
      `Hit ${position}\n` +
      `${hit.boundary ? "Boundary" : "Interior"} · Adjacent elements ${owners}\n` +
      `Vertices ${hit.vertices.length}`
    );
  }
  return (
    `Element ${hit.elementId}\n` +
    `Part ${hit.partId} · Instance ${hit.instanceId}\n` +
    `Normal ${formatVec(hit.normal)}\n` +
    `Hit ${position}`
  );
}

function formatVec(vector: readonly [number, number, number]): string {
  return `(${format(vector[0])}, ${format(vector[1])}, ${format(vector[2])})`;
}

function format(value: number): string {
  const rounded = Math.abs(value) < 1e-6 ? 0 : Number(value.toPrecision(4));
  return String(rounded);
}
