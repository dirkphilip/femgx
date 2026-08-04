import type { Color } from "../interaction/interaction";

/** A gradient anchor: a color at a normalized offset within a value range. */
export interface ColorStop {
  /** Normalized position within `[0, 1]` of the map range. */
  readonly offset: number;
  readonly color: Color;
}

/** A band boundary color or a continuous gradient stop color at its offset. */
export interface LegendEntry {
  /** Normalized position within `[0, 1]` used to lay out a legend bar. */
  readonly fraction: number;
  readonly color: Color;
  /** Human-readable label for the value (or value band) at this entry. */
  readonly label: string;
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
  return {
    min: options.min,
    max: options.max,
    stops,
    missingColor: options.missingColor ?? DEFAULT_MISSING,
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

/**
 * Returns the legend entries used to render a color bar: one entry per stop
 * for continuous maps, or one entry per band for thresholded maps. Missing
 * values are not part of the legend; render them with `missingColor`.
 */
export function legend(map: ScalarColorMap): readonly LegendEntry[] {
  if (map.thresholds === undefined) {
    return map.stops.map((stop) => ({
      fraction: stop.offset,
      color: stop.color,
      label: formatScalar(map.min + stop.offset * (map.max - map.min)),
    }));
  }
  const bands = map.thresholds.length + 1;
  const entries: LegendEntry[] = [];
  let lower = map.min;
  for (let band = 0; band < bands; band++) {
    const upper = band < map.thresholds.length ? (map.thresholds[band] ?? map.max) : map.max;
    entries.push({
      fraction: (band + 0.5) / bands,
      color: bandColor(map, band),
      label: `${formatScalar(lower)} – ${formatScalar(upper)}`,
    });
    lower = upper;
  }
  return entries;
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
  return [...stops].sort((a, b) => a.offset - b.offset);
}

function validateRange(min: number, max: number): void {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new Error("Scalar color map range must be finite");
  }
  if (min >= max) {
    throw new Error(`Scalar color map range must satisfy min < max, got [${min}, ${max}]`);
  }
}

function validateThresholds(
  thresholds: readonly number[],
  min: number,
  max: number,
): readonly number[] {
  const sorted = [...thresholds].sort((a, b) => a - b);
  for (const threshold of sorted) {
    if (!Number.isFinite(threshold) || threshold <= min || threshold >= max) {
      throw new Error(
        `Scalar color map thresholds must be finite and strictly inside (${min}, ${max})`,
      );
    }
  }
  return sorted;
}

function formatScalar(value: number): string {
  return Number(value.toPrecision(3)).toString();
}
