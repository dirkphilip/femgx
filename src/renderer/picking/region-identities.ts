import type { InteractionTarget } from "../../interaction/target-types";
import type { InteractionGranularity } from "../../picking/types";
import type { PickContext } from "../../picking/pick";
import { decodePickId } from "./pick-format";
import type { PickRegionProbe } from "./region-probe";
import { createPickRegionTargetResolver } from "./region-resolver";
import { createPickRegionTargetCollector } from "./region-targets";

export type RegionAttachment = "instance" | "element" | "face" | "node";

interface RawIdentity {
  instancePickId: number;
  elementPickId: number;
  facePickId: number;
  nodePickId: number;
}

export type RawIdentities = Map<number, Map<number, RawIdentity>>;

/** Decodes non-element visible samples into the descriptor-oriented pick path. */
export function decodeRegion(
  bytes: Uint8Array,
  width: number,
  height: number,
  bytesPerRow: number,
  target: {
    readonly attachments: readonly RegionAttachment[];
    readonly identities: RawIdentities;
    readonly probe: PickRegionProbe | undefined;
  },
): void {
  const { attachments, identities, probe } = target;
  const secondaryAttachment = attachments[1];
  const secondaryOffset = secondaryAttachment === undefined ? 0 : bytesPerRow * height;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = bytesPerRow * y + x * 4;
      const instancePickId = decodePickId(bytes, offset);
      if (instancePickId === 0) continue;
      const secondaryPickId =
        secondaryAttachment === undefined ? 0 : decodePickId(bytes, secondaryOffset + offset);
      if (secondaryAttachment !== undefined && secondaryPickId === 0) continue;
      recordIdentity(identities, instancePickId, secondaryAttachment, secondaryPickId, probe);
    }
  }
}

/** Resolves retained non-element identities through their existing target path. */
export function resolveTargets(
  identities: RawIdentities,
  options: {
    readonly context: PickContext;
    readonly granularity: InteractionGranularity;
    readonly probe?: PickRegionProbe;
  },
): readonly InteractionTarget[] {
  const resolveTarget = createPickRegionTargetResolver(options.context, options.granularity);
  const resolved = createPickRegionTargetCollector();
  for (const bySecondary of identities.values()) {
    for (const ids of bySecondary.values()) {
      try {
        const target = resolveTarget(ids);
        if (target === undefined) continue;
        if (options.probe !== undefined) options.probe.resolvedTargetDescriptors += 1;
        resolved.add(target, ids.instancePickId);
      } catch {
        // Stale or malformed attachment ids are ignored at the ownership boundary.
      }
    }
  }
  return resolved.finish();
}

function recordIdentity(
  identities: RawIdentities,
  instancePickId: number,
  secondaryAttachment: RegionAttachment | undefined,
  secondaryPickId: number,
  probe: PickRegionProbe | undefined,
): void {
  let bySecondary = identities.get(instancePickId);
  if (bySecondary === undefined) {
    bySecondary = new Map();
    identities.set(instancePickId, bySecondary);
  }
  if (bySecondary.has(secondaryPickId)) return;
  const ids = { instancePickId, elementPickId: 0, facePickId: 0, nodePickId: 0 };
  if (probe !== undefined) probe.rawIdentityObjects += 1;
  if (secondaryAttachment !== undefined) setPickId(ids, secondaryAttachment, secondaryPickId);
  bySecondary.set(secondaryPickId, ids);
}

function setPickId(ids: RawIdentity, attachment: RegionAttachment, value: number): void {
  switch (attachment) {
    case "instance":
      ids.instancePickId = value;
      return;
    case "element":
      ids.elementPickId = value;
      return;
    case "face":
      ids.facePickId = value;
      return;
    case "node":
      ids.nodePickId = value;
      return;
  }
}
