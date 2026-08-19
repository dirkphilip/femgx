import {
  createScene,
  createViewport,
  translation,
  type PartOccurrenceId,
  type PickHit,
  type Viewport,
} from "femgx";
import { installViewportInteraction } from "femgx/interaction";
import { ingestHostModel, type IngestedHostModel } from "./host-model.js";

interface MountedExample {
  readonly viewport: Viewport;
  destroy(): void;
}

interface InspectionContext {
  readonly canvas: HTMLCanvasElement;
  readonly viewport: Viewport;
  readonly ingested: IngestedHostModel;
  readonly overloadedOccurrenceId: PartOccurrenceId;
  readonly output: HTMLOutputElement;
}

/** Mounts the complete host-model integration into the example document. */
export async function mountHostIntegration(): Promise<MountedExample> {
  const canvas = requiredElement("viewport", HTMLCanvasElement);
  const diagnostics = requiredElement("diagnostics", HTMLOutputElement);
  const inspection = requiredElement("inspection", HTMLOutputElement);
  const ingested = ingestHostModel((issue) => {
    diagnostics.value += `${issue.severity}: ${issue.code}: ${issue.message}\n`;
  });
  if (ingested.issues.length === 0) diagnostics.value = "Model validation passed";
  const scene = createScene()
    .addPart(ingested.part)
    .addAssembly({
      id: 200,
      name: "two load cases",
      placements: [
        {
          kind: "part",
          placementId: "baseline",
          partId: ingested.part.id,
          transform: translation(-1.5, 0, 0),
        },
        {
          kind: "part",
          placementId: "overloaded",
          partId: ingested.part.id,
          transform: translation(1.5, 0, 0),
        },
      ],
    })
    .withRoot(200)
    .build();
  const viewport = await createViewport({ canvas, scene, background: "studio" });
  const occurrenceIds = viewport.runtime.getPartOccurrenceIds();
  const overloadedOccurrenceId = required(occurrenceIds[1], "overloaded part occurrence");
  viewport.results.set({
    scalar: { field: ingested.baselineStress, range: { min: 100, max: 300 } },
    deformation: { field: ingested.baselineDisplacement, scale: 1 },
    occurrences: [
      {
        partOccurrenceId: overloadedOccurrenceId,
        scalar: { field: ingested.overloadedStress, range: { min: 100, max: 300 } },
        deformation: { field: ingested.overloadedDisplacement, scale: 1 },
      },
    ],
  });
  viewport.presentation.setSectionPlane({ normal: [0, 1, 0], distance: 0 });
  const disposeSelection = installViewportInteraction({
    viewport,
    canvas,
    granularity: () => "body",
    onError: (error, phase) => {
      diagnostics.value += `Interaction ${phase} failed: ${String(error)}\n`;
    },
  });
  const inspectionContext: InspectionContext = {
    canvas,
    viewport,
    ingested,
    overloadedOccurrenceId,
    output: inspection,
  };
  const inspect = (event: MouseEvent): void => {
    void inspectAt(event, inspectionContext);
  };
  canvas.addEventListener("click", inspect);
  let destroyed = false;
  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    window.removeEventListener("beforeunload", destroy);
    canvas.removeEventListener("click", inspect);
    disposeSelection();
    viewport.destroy();
  };
  window.addEventListener("beforeunload", destroy, { once: true });
  viewport.view.fit();
  return { viewport, destroy };
}

async function inspectAt(event: MouseEvent, context: InspectionContext): Promise<void> {
  const bounds = context.canvas.getBoundingClientRect();
  const hit = await context.viewport.interaction.pick(
    event.clientX - bounds.left,
    event.clientY - bounds.top,
  );
  context.output.value = describeHit(hit, context.ingested, context.overloadedOccurrenceId);
}

function describeHit(
  hit: PickHit | undefined,
  ingested: IngestedHostModel,
  overloadedOccurrenceId: PartOccurrenceId,
): string {
  if (hit === undefined) return "No authored entity under pointer";
  const result =
    hit.partOccurrenceId === overloadedOccurrenceId ? ingested.overloaded : ingested.baseline;
  if (hit.kind === "node") {
    const hostNodeId = required(
      ingested.nodeHostIdsByOrdinal[hit.nodeId],
      `host node for ordinal ${hit.nodeId}`,
    );
    const displacement = required(
      result.displacementByNodeId.get(hostNodeId),
      `displacement for ${hostNodeId}`,
    );
    return `${hostNodeId}: displacement [${displacement.join(", ")}] mm`;
  }
  if (hit.kind === "element" || hit.kind === "face") {
    const stress = required(
      result.stressByElementId.get(hit.elementId),
      `stress for element ${hit.elementId}`,
    );
    return `Element ${hit.elementId}: von Mises ${stress} MPa`;
  }
  if (hit.kind === "edge") {
    const hostNodes = hit.nodeIds.map(
      (ordinal) => ingested.nodeHostIdsByOrdinal[ordinal] ?? `ordinal ${ordinal}`,
    );
    return `Edge ${hostNodes.join(" → ")}`;
  }
  return `Placed part ${hit.partOccurrenceId}`;
}

function requiredElement<ElementType extends Element>(
  id: string,
  constructor: { new (): ElementType },
): ElementType {
  const element = document.querySelector(`#${id}`);
  if (!(element instanceof constructor)) throw new Error(`Missing #${id}`);
  return element;
}

function required<Value>(value: Value | undefined, label: string): Value {
  if (value === undefined) throw new Error(`Missing ${label}`);
  return value;
}

void mountHostIntegration().catch((error: unknown) => {
  const output = document.querySelector<HTMLOutputElement>("#diagnostics");
  if (output !== null) output.value = error instanceof Error ? error.message : String(error);
});
