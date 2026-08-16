import type { ReadyColorTargets } from "../resources/color-targets";

export type WeightedColorTargets = ReadyColorTargets &
  Required<
    Pick<
      ReadyColorTargets,
      "opaqueColor" | "accumulation" | "revealage" | "msaaAccumulation" | "msaaRevealage"
    >
  >;

/** Narrows the target record after the visible frame requested weighted OIT. */
export function requireWeightedTargets(targets: ReadyColorTargets): WeightedColorTargets {
  const { color, depth, opaqueColor, accumulation, revealage, msaaAccumulation, msaaRevealage } =
    targets;
  if (
    opaqueColor === undefined ||
    accumulation === undefined ||
    revealage === undefined ||
    msaaAccumulation === undefined ||
    msaaRevealage === undefined
  ) {
    throw new Error("Weighted transparency targets are unavailable");
  }
  return { color, depth, opaqueColor, accumulation, revealage, msaaAccumulation, msaaRevealage };
}
