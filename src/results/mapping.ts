import type { Color } from "../interaction/interaction";

/** A gradient anchor: a color at a normalized offset within a value range. */
export interface ColorStop {
  /** Normalized position within `[0, 1]` of the map range. */
  readonly offset: number;
  readonly color: Color;
}

/**
 * A scalar-to-color map over a fixed range. Values below `min` clamp to the
 * first stop color and values above `max` to the last (clipping); `NaN` maps
 * to `missingColor`; values between bands map through the continuous ramp.
 */
export interface ScalarColorMap {
  readonly min: number;
  readonly max: number;
  /** Gradient stops, sorted by ascending offset. */
  readonly stops: readonly ColorStop[];
  /** Color for missing (`NaN`) values. */
  readonly missingColor: Color;
  /** Optional ascending band boundaries strictly inside `(min, max)`. */
  readonly thresholds: readonly number[] | undefined;
}

/** Inputs for {@link createScalarColorMap}. */
export interface ScalarColorMapOptions {
  readonly min: number;
  readonly max: number;
  /** Continuous gradient stops; defaults to a blue-cyan-yellow-red ramp. */
  readonly stops?: readonly ColorStop[];
  /** When set, discrete band boundaries that turn mapping thresholded. */
  readonly thresholds?: readonly number[];
  /** Color for missing (`NaN`) values; defaults to neutral gray. */
  readonly missingColor?: Color;
}

const DEFAULT_STOPS: readonly ColorStop[] = [
  { offset: 0, color: { r: 0.12, g: 0.34, b: 0.95, a: 1 } },
  { offset: 0.25, color: { r: 0.1, g: 0.75, b: 0.9, a: 1 } },
  { offset: 0.5, color: { r: 0.95, g: 0.85, b: 0.2, a: 1 } },
  { offset: 0.75, color: { r: 0.95, g: 0.45, b: 0.1, a: 1 } },
  { offset: 1, color: { r: 0.75, g: 0.05, b: 0.1, a: 1 } },
];

const DEFAULT_MISSING: Color = { r: 0.55, g: 0.55, b: 0.55, a: 1 };

/** Creates a scalar color map after validating the range and thresholds. */
export function createScalarColorMap(options: ScalarColorMapOptions): ScalarColorMap {
  validateRange(options.min, options.max);
  const stops = sortStops(options.stops ?? DEFAULT_STOPS);
  const thresholds =
    options.thresholds === undefined
      ? undefined
      : validateThresholds(options.thresholds, options.min, options.max);
  const missingColor = options.missingColor === undefined ? DEFAULT_MISSING : options.missingColor;
  validateColor("missingColor", missingColor);
  return {
    min: options.min,
    max: options.max,
    stops,
    missingColor,
    thresholds,
  };
}

/**
 * Maps a scalar value to a color: clips out-of-range values to the nearest
 * stop, interpolates between stops (or returns the band color when the map is
 * thresholded), and returns `missingColor` for `NaN`.
 */
export function mapScalar(map: ScalarColorMap, value: number): Color {
  if (!Number.isFinite(value)) return map.missingColor;
  if (map.thresholds !== undefined) {
    return bandColor(map, bandIndex(map.thresholds, value));
  }
  return rampColor(map.stops, normalize(map, value));
}

function normalize(map: ScalarColorMap, value: number): number {
  const t = (value - map.min) / (map.max - map.min);
  return Math.min(1, Math.max(0, t));
}

function rampColor(stops: readonly ColorStop[], t: number): Color {
  const first = stops[0];
  if (first === undefined) return { r: 0, g: 0, b: 0, a: 1 };
  if (t <= first.offset) return first.color;
  const last = stops[stops.length - 1];
  if (last !== undefined && t >= last.offset) return last.color;
  for (let index = 1; index < stops.length; index++) {
    const stop = stops[index];
    const previous = stops[index - 1];
    if (stop === undefined || previous === undefined) continue;
    if (t <= stop.offset) {
      const span = stop.offset - previous.offset;
      const local = span === 0 ? 0 : (t - previous.offset) / span;
      return lerpColor(previous.color, stop.color, Math.min(1, Math.max(0, local)));
    }
  }
  return last?.color ?? { r: 0, g: 0, b: 0, a: 1 };
}

function bandIndex(thresholds: readonly number[], value: number): number {
  let band = 0;
  for (const threshold of thresholds) {
    if (value >= threshold) band += 1;
    else break;
  }
  return band;
}

function bandColor(map: ScalarColorMap, band: number): Color {
  const thresholds = map.thresholds;
  const bands = (thresholds?.length ?? 0) + 1;
  const t = bands > 1 ? band / (bands - 1) : 0;
  return rampColor(map.stops, t);
}

function lerpColor(a: Color, b: Color, t: number): Color {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
    a: a.a + (b.a - a.a) * t,
  };
}

function sortStops(stops: readonly ColorStop[]): readonly ColorStop[] {
  if (stops.length === 0) {
    throw new RangeError("Scalar color map stops must contain at least one stop");
  }
  for (let index = 0; index < stops.length; index++) {
    const stop = stops[index] as ColorStop | null | undefined;
    if (stop === null || stop === undefined) {
      throw new TypeError(`stops[${index}] must be a color stop`);
    }
    validateUnit(`stops[${index}].offset`, stop.offset);
    validateColor(`stops[${index}].color`, stop.color);
  }
  const sorted = [...stops].sort((a, b) => a.offset - b.offset);
  for (let index = 1; index < sorted.length; index++) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (previous !== undefined && current !== undefined && previous.offset >= current.offset) {
      throw new RangeError(
        `Scalar color map stop offsets must be strictly increasing (stops[${index - 1}].offset and stops[${index}].offset)`,
      );
    }
  }
  return sorted;
}

function validateRange(min: number, max: number): void {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new RangeError("Scalar color map range must be finite");
  }
  if (min >= max) {
    throw new RangeError(`Scalar color map range must satisfy min < max, got [${min}, ${max}]`);
  }
}

function validateThresholds(
  thresholds: readonly number[],
  min: number,
  max: number,
): readonly number[] {
  for (let index = 0; index < thresholds.length; index++) {
    const threshold = thresholds[index];
    if (
      threshold === undefined ||
      !Number.isFinite(threshold) ||
      threshold <= min ||
      threshold >= max
    ) {
      throw new RangeError(
        `thresholds[${index}] must be finite and strictly inside (${min}, ${max})`,
      );
    }
  }
  const sorted = [...thresholds].sort((a, b) => a - b);
  for (let index = 1; index < sorted.length; index++) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (previous !== undefined && current !== undefined && previous >= current) {
      throw new RangeError(
        `Scalar color map thresholds must be strictly increasing (thresholds[${index - 1}] and thresholds[${index}])`,
      );
    }
  }
  return sorted;
}

function validateColor(name: string, color: unknown): void {
  if (typeof color !== "object" || color === null) {
    throw new TypeError(`${name} must be an RGBA color`);
  }
  const channels = color as {
    readonly r?: unknown;
    readonly g?: unknown;
    readonly b?: unknown;
    readonly a?: unknown;
  };
  validateUnit(`${name}.r`, channels.r);
  validateUnit(`${name}.g`, channels.g);
  validateUnit(`${name}.b`, channels.b);
  validateUnit(`${name}.a`, channels.a);
}

function validateUnit(name: string, value: unknown): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be finite and in [0, 1]`);
  }
}
