export type RenderLoopState = "Idle" | "Warming up" | "Continuous";

interface InvalidatableViewport {
  invalidate(): void;
}

export interface RenderLoopStats {
  readonly state: RenderLoopState;
  readonly sampleDurationMs: number;
  readonly sampleFrameCount: number;
  readonly averageFps: number;
  readonly p50FrameIntervalMs: number | undefined;
  readonly p95FrameIntervalMs: number | undefined;
  readonly longestFrameIntervalMs: number | undefined;
}

export const IDLE_RENDER_LOOP_STATS: RenderLoopStats = {
  state: "Idle",
  sampleDurationMs: 0,
  sampleFrameCount: 0,
  averageFps: 0,
  p50FrameIntervalMs: undefined,
  p95FrameIntervalMs: undefined,
  longestFrameIntervalMs: undefined,
};

const WARMUP_MS = 500;
const WINDOW_MS = 2_500;
const PUBLISH_MS = 250;

/** Calculates bounded render-loop statistics from render-completion timestamps. */
export function calculateRenderLoopStats(
  frameTimes: readonly number[],
  enabledAt: number,
  now: number,
): RenderLoopStats {
  if (frameTimes.length === 0) return warmingStats(now - enabledAt, 0);
  const intervals = frameIntervals(frameTimes);
  const sampleDurationMs = Math.max(0, now - (frameTimes[0] ?? now));
  const warmup = now - enabledAt < WARMUP_MS;
  return {
    state: warmup ? "Warming up" : "Continuous",
    sampleDurationMs,
    sampleFrameCount: frameTimes.length,
    averageFps: sampleDurationMs === 0 ? 0 : (intervals.length * 1000) / sampleDurationMs,
    p50FrameIntervalMs: percentile(intervals, 0.5),
    p95FrameIntervalMs: percentile(intervals, 0.95),
    longestFrameIntervalMs: intervals.length === 0 ? undefined : Math.max(...intervals),
  };
}

/** Owns the single demo invalidation chain and its bounded rolling sample. */
export class WorkbenchRenderLoop {
  private enabled = false;
  private attached = true;
  private enabledAt = 0;
  private lastPublishedAt = Number.NEGATIVE_INFINITY;
  private frameTimes: number[] = [];
  private currentStats: RenderLoopStats = IDLE_RENDER_LOOP_STATS;

  constructor(private readonly getViewport: () => InvalidatableViewport | undefined) {}

  get stats(): RenderLoopStats {
    return this.currentStats;
  }

  setEnabled(enabled: boolean, now: number): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.resetStats(now);
    if (enabled) this.invalidate();
  }

  reset(now: number): void {
    this.resetStats(now);
    if (this.enabled) this.invalidate();
  }

  detach(now: number): void {
    this.attached = false;
    this.resetStats(now);
  }

  attach(now: number): void {
    this.attached = true;
    this.resetStats(now);
    if (this.enabled) this.invalidate();
  }

  stop(): void {
    this.enabled = false;
    this.attached = false;
    this.currentStats = IDLE_RENDER_LOOP_STATS;
  }

  /** Records one completed viewport render and returns whether DOM may refresh. */
  frameCompleted(timestamp: number): boolean {
    if (!this.enabled || !this.attached) return false;
    this.frameTimes.push(timestamp);
    const cutoff = timestamp - WINDOW_MS;
    while (this.frameTimes.length > 1 && (this.frameTimes[0] ?? timestamp) < cutoff) {
      this.frameTimes.shift();
    }
    this.currentStats = calculateRenderLoopStats(this.frameTimes, this.enabledAt, timestamp);
    const publish = timestamp - this.lastPublishedAt >= PUBLISH_MS;
    if (publish) this.lastPublishedAt = timestamp;
    this.invalidate();
    return publish;
  }

  private resetStats(now: number): void {
    this.enabledAt = now;
    this.lastPublishedAt = Number.NEGATIVE_INFINITY;
    this.frameTimes = [];
    this.currentStats = this.enabled ? warmingStats(0, 0) : IDLE_RENDER_LOOP_STATS;
  }

  private invalidate(): void {
    if (!this.enabled || !this.attached) return;
    this.getViewport()?.invalidate();
  }
}

function warmingStats(sampleDurationMs: number, sampleFrameCount: number): RenderLoopStats {
  return {
    state: "Warming up",
    sampleDurationMs,
    sampleFrameCount,
    averageFps: 0,
    p50FrameIntervalMs: undefined,
    p95FrameIntervalMs: undefined,
    longestFrameIntervalMs: undefined,
  };
}

function frameIntervals(frameTimes: readonly number[]): number[] {
  const intervals: number[] = [];
  for (let index = 1; index < frameTimes.length; index += 1) {
    const current = frameTimes[index];
    const previous = frameTimes[index - 1];
    if (current !== undefined && previous !== undefined) intervals.push(current - previous);
  }
  return intervals.sort((a, b) => a - b);
}

function percentile(sortedValues: readonly number[], ratio: number): number | undefined {
  if (sortedValues.length === 0) return undefined;
  const position = (sortedValues.length - 1) * ratio;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const lowerValue = sortedValues[lower];
  const upperValue = sortedValues[upper];
  if (lowerValue === undefined || upperValue === undefined) return undefined;
  return lowerValue + (upperValue - lowerValue) * (position - lower);
}
