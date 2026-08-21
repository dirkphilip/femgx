import { expect } from "vitest";

type ActualElementRegionEvidence = readonly [
  visibleOne: Readonly<Record<string, number>>,
  visibleFour: Readonly<Record<string, number>>,
  throughOne: Readonly<Record<string, number>>,
  throughFour: Readonly<Record<string, number>>,
  lifecycle: Readonly<Record<string, number>>,
];

/** Verifies that reported structure comes from each exercised production path. */
export function assertActualElementRegionEvidence(
  evidence: ActualElementRegionEvidence,
  perOccurrence: number,
): void {
  const [visibleOne, visibleFour, throughOne, throughFour, lifecycle] = evidence;
  expect(visibleOne).toMatchObject({
    rawIdentityObjects: 0,
    resolvedTargetDescriptors: 0,
    elementPickGroups: 1,
    elementPickIds: perOccurrence,
    elementScratchGrowths: 0,
    selectedIdentities: perOccurrence,
    occurrenceGroups: 1,
  });
  expect(visibleFour).toMatchObject({
    rawIdentityObjects: 0,
    resolvedTargetDescriptors: 0,
    elementPickGroups: 4,
    elementPickIds: perOccurrence * 4,
    elementScratchGrowths: 0,
    selectedIdentities: perOccurrence * 4,
    occurrenceGroups: 4,
  });
  expect(throughOne).toMatchObject({
    occurrencesVisited: 1,
    elementsVisited: perOccurrence,
    intersectionTests: perOccurrence,
    selectedIdentities: perOccurrence,
    groupsCreated: 1,
  });
  expect(throughFour).toMatchObject({
    occurrencesVisited: 4,
    elementsVisited: perOccurrence * 4,
    intersectionTests: perOccurrence * 4,
    selectedIdentities: perOccurrence * 4,
    groupsCreated: 4,
  });
  expect(lifecycle).toMatchObject({
    descriptorVisits: 0,
    targetKeyStrings: 0,
    defaultElementTransitions: 1,
    callbackSelectionCopies: 2,
    statePublications: 1,
    boxCallbacks: 1,
    applyCallbacks: 1,
  });
}
