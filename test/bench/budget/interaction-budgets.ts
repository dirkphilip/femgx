import { createSceneBuilder, translationMatrix } from "@/entries/root";
import {
  createInteractionState,
  selectedTargets,
  setPartOverrides,
  setTargetsHighlighted,
  setTargetsSelected,
} from "@/entries/interaction";
import { createSceneOccurrenceSnapshot } from "@/scene-runtime/occurrences";
import { buildHighlightTable } from "@/renderer/selection/highlight-table";
import {
  collectEmphasisUpdates,
  encodeEmphasisRecord,
} from "@/renderer/resources/element-resources";
import { defaultStyle } from "@/renderer/resources/foundation";
import { getPartSemanticIndex } from "@/geometry/part-semantic-index";
import type { BudgetCase, ScalingCase } from "./types";
import {
  emphasisPart,
  emphasisScene,
  emphasisRuntime,
  emphasisLayout,
  emphasisSlotByInstanceId,
  emphasisElementIds,
  emphasisInteraction,
  emphasisDenseSelections,
  bulkSelectionTargets,
  duplicateBulkSelectionTargets,
  bulkHighlightTargets,
  largeElementSelectionTargets,
  phaseSelectionTargets,
  phaseSelectionStates,
  sceneBuilderParts,
  emphasisTableEntries,
} from "./interaction-fixtures";

const INTERACTION_SCALING_COUNTS = [1_024, 4_096, 16_384] as const;
const PART_OVERRIDE_SCALING_COUNTS = [25_000, 50_000, 100_000] as const;
const partOverrideEntries = new Map(
  PART_OVERRIDE_SCALING_COUNTS.map((count) => [
    count,
    Array.from({ length: count }, (_, partId) => [partId, { opacity: 0.5 }] as const),
  ]),
);

export const interactionBudgets: readonly BudgetCase[] = [
  {
    name: "setPartOverrides (100,000 parts)",
    description: "one immutable bulk style transition for a many-part display scene",
    budgetMs: 100,
    run: () => {
      setPartOverrides(createInteractionState(), partOverrideEntries.get(100_000) ?? []);
    },
  },
  {
    name: "setTargetsSelected (16,384 elements)",
    description: "one immutable bulk transition in one occurrence",
    budgetMs: 100,
    run: () => {
      setTargetsSelected(createInteractionState(), bulkSelectionTargets, true);
    },
  },
  {
    name: "setTargetsSelected duplicate inputs (16,384 elements)",
    description: "one bulk transition with 1,024 repeated identities",
    budgetMs: 100,
    run: () => {
      setTargetsSelected(createInteractionState(), duplicateBulkSelectionTargets, true);
    },
  },
  {
    name: "setTargetsSelected (131,712 mixed-occurrence elements)",
    description: "one immutable bulk transition independent of FE element topology",
    budgetMs: 35,
    run: () => {
      setTargetsSelected(createInteractionState(), largeElementSelectionTargets, true);
    },
  },
  {
    name: "setTargetsHighlighted (8,192 elements)",
    description: "one duplicate-safe immutable bulk transition in one occurrence",
    budgetMs: 100,
    run: () => {
      setTargetsHighlighted(createInteractionState(), bulkHighlightTargets, true);
    },
  },
  {
    name: "buildHighlightTable (16,384 records)",
    description: "bounded four-entry buckets for repeated placements",
    budgetMs: 1_500,
    run: () => {
      buildHighlightTable(emphasisTableEntries);
    },
  },
  {
    name: "encodeEmphasisRecord mirror (16,384 records)",
    description: "CPU mirror preparation for selected element records",
    budgetMs: 100,
    run: () => {
      for (const entry of emphasisTableEntries) {
        encodeEmphasisRecord({
          slot: entry.slot,
          elementPickId: entry.elementPickId,
          facePickId: entry.facePickId,
          nodePickId: entry.nodePickId,
          style: defaultStyle,
        });
      }
    },
  },
  {
    name: "immutable part ownership lookup (16,384 elements)",
    description: "cached element-to-body metadata map reads",
    budgetMs: 100,
    run: () => {
      const metadata = getPartSemanticIndex(emphasisPart);
      for (const elementId of emphasisElementIds) metadata.bodyForElement(elementId);
    },
  },
  {
    name: "collectEmphasisUpdates (16,384 elements)",
    description: "dense selection avoids per-element sparse records",
    budgetMs: 25,
    run: () => {
      collectEmphasisUpdates(emphasisRuntime, emphasisLayout, emphasisSlotByInstanceId, {
        parts: emphasisScene.parts,
        interaction: emphasisInteraction,
        denseSelections: emphasisDenseSelections,
      });
    },
  },
];

export const interactionScalingCases: readonly ScalingCase[] = [
  {
    name: "many-part style overrides",
    description: "apply 25,000–100,000 part styles in one immutable transition",
    points: PART_OVERRIDE_SCALING_COUNTS.map((size) => ({
      size,
      run: () => {
        setPartOverrides(createInteractionState(), partOverrideEntries.get(size) ?? []);
      },
    })),
    maxNormalizedSpread: 3,
  },
  {
    name: "many-part scene build",
    description: "register, place, snapshot, and compile 1,024–4,096 reusable parts",
    points: [1_024, 2_048, sceneBuilderParts.length].map((size) => ({
      size,
      run: () => {
        const parts = sceneBuilderParts.slice(0, size);
        let builder = createSceneBuilder();
        for (const part of parts) builder = builder.addPart(part);
        const scene = builder
          .addAssembly({
            id: 1,
            name: "root",
            placements: parts.map((part, index) => ({
              kind: "part" as const,
              placementId: String(index),
              partId: part.id,
              transform: translationMatrix(part.id, 0, 0),
            })),
          })
          .setRootAssembly(1)
          .build();
        createSceneOccurrenceSnapshot(scene);
      },
    })),
    maxNormalizedSpread: 5,
  },
  {
    name: "element interaction updates",
    description: "select, enumerate, and clear 1,024–16,384 targets",
    points: INTERACTION_SCALING_COUNTS.map((count) => {
      const targets = phaseSelectionTargets.get(count);
      const selected = phaseSelectionStates.get(count);
      if (targets === undefined || selected === undefined)
        throw new Error(`Missing ${count} targets`);
      return {
        size: count,
        run: () => {
          setTargetsSelected(createInteractionState(), targets, true);
          selectedTargets(selected);
          setTargetsSelected(selected, targets, false);
        },
      };
    }),
    maxNormalizedSpread: 3,
    iterations: 2,
  },
];
