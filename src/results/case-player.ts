import { createResultField, type VectorField } from "./fields";

/** How playback advances past the last case. */
export type CaseLoopMode = "wrap" | "clamp";

/** Options for {@link createCasePlayer}. */
export interface CasePlayerOptions {
  /** Seconds spent on each case before advancing; defaults to 1. */
  readonly caseDuration?: number;
  /** Whether playback wraps to the first case or clamps at the last; defaults to "wrap". */
  readonly loop?: CaseLoopMode;
  /** Blend the displacement into the next case for smooth deformation; defaults to false. */
  readonly interpolate?: boolean;
}

/**
 * Immutable playback state over an ordered list of nodal displacement fields.
 * Advancing it over time produces the active case index plus an optional blend
 * factor toward the next case, so a consumer can serve per-case data (stresses,
 * derived fields) and optionally morph the deformation between adjacent cases.
 */
export interface CasePlayer {
  /** The displacement fields being played, in playback order. */
  readonly cases: readonly VectorField<"nodal">[];
  /** Seconds spent on each case before advancing. */
  readonly caseDuration: number;
  readonly loop: CaseLoopMode;
  /** Whether {@link sampleDisplacements} blends into the next case. */
  readonly interpolate: boolean;
  /** Index of the currently active case. */
  readonly caseIndex: number;
  /** Seconds elapsed within the current case duration. */
  readonly elapsed: number;
  /** Progress within the current case duration, clamped to `[0, 1]`. */
  readonly progress: number;
  /** Case blended toward during interpolation, or `-1` when there is no next case. */
  readonly nextCaseIndex: number;
  /** Blend factor toward the next case in `[0, 1)`; `0` when not interpolating. */
  readonly blend: number;
}

/**
 * Creates a case player over nodal displacement fields, validating that the
 * fields are non-empty and share the same entity count and unit (they must be
 * index-aligned to the same model).
 */
export function createCasePlayer(
  cases: readonly VectorField<"nodal">[],
  options: CasePlayerOptions = {},
): CasePlayer {
  validateCases(cases);
  const caseDuration = options.caseDuration ?? 1;
  const loop = options.loop ?? "wrap";
  const interpolate = options.interpolate ?? false;
  validateOptions(caseDuration, loop);
  return {
    cases,
    caseDuration,
    loop,
    interpolate,
    caseIndex: 0,
    elapsed: 0,
    progress: 0,
    nextCaseIndex: cases.length > 1 ? 1 : -1,
    blend: 0,
  };
}

/**
 * Advances playback by `deltaSeconds`. Negative deltas are clamped to zero, so
 * playback only moves forward. A delta of one full case duration advances to
 * the next case with no residual blend, matching a manual step.
 */
export function advanceCase(player: CasePlayer, deltaSeconds: number): CasePlayer {
  const duration = player.caseDuration;
  const total = player.elapsed + Math.max(0, deltaSeconds);
  const steps = Math.floor(total / duration);
  let elapsed = total - steps * duration;
  let caseIndex = player.caseIndex + steps;
  if (player.loop === "wrap") {
    caseIndex = caseIndex % player.cases.length;
  } else if (caseIndex >= player.cases.length) {
    caseIndex = player.cases.length - 1;
    elapsed = duration;
  }
  const last = player.cases.length - 1;
  const nextCaseIndex = caseIndex < last ? caseIndex + 1 : player.loop === "wrap" ? 0 : -1;
  const progress = Math.min(1, elapsed / duration);
  const blend = player.interpolate && nextCaseIndex >= 0 ? progress : 0;
  return { ...player, caseIndex, elapsed, progress, nextCaseIndex, blend };
}

/**
 * Returns the displacement field for the current playback position: the active
 * case directly when not blending, or a component-wise linear blend toward the
 * next case. Missing (`NaN`) components propagate through the blend. The
 * returned field is freshly computed only while blending; otherwise the source
 * field is returned without copying.
 */
export function sampleDisplacements(player: CasePlayer): VectorField<"nodal"> {
  const from = caseAt(player, player.caseIndex);
  if (player.blend === 0 || player.nextCaseIndex < 0) return from;
  const to = caseAt(player, player.nextCaseIndex);
  return interpolateFields(from, to, player.blend);
}

function caseAt(player: CasePlayer, index: number): VectorField<"nodal"> {
  const caze = player.cases[index];
  if (caze === undefined) {
    throw new Error(`Case player has no case at index ${index}`);
  }
  return caze;
}

function validateCases(cases: readonly VectorField<"nodal">[]): void {
  if (cases.length === 0) {
    throw new Error("Case player requires at least one displacement case");
  }
  const first = cases[0];
  if (first === undefined) return;
  for (const caze of cases) {
    if (caze.count !== first.count || caze.unit !== first.unit) {
      throw new Error("Case player cases must share the same count and unit");
    }
  }
}

function validateOptions(caseDuration: number, loop: CaseLoopMode): void {
  if (!Number.isFinite(caseDuration) || caseDuration <= 0) {
    throw new Error(`Case duration must be a positive finite number, got ${caseDuration}`);
  }
  if (!["wrap", "clamp"].includes(loop)) {
    throw new Error(`Unknown case loop mode "${loop}"`);
  }
}

function interpolateFields(
  from: VectorField<"nodal">,
  to: VectorField<"nodal">,
  blend: number,
): VectorField<"nodal"> {
  const values = new Float32Array(from.values.length);
  for (let index = 0; index < from.values.length; index++) {
    const a = from.values[index] ?? 0;
    const b = to.values[index] ?? 0;
    values[index] = a + (b - a) * blend;
  }
  return createResultField({
    id: `${from.id}~${to.id}`,
    name: `${from.name} (blend)`,
    location: "nodal",
    shape: "vector",
    count: from.count,
    unit: from.unit,
    values,
  });
}
