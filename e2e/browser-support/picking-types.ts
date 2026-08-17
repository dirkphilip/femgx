/** A resolved canvas point whose dataset key matched the sweep. */
export interface SweepHit {
  readonly x: number;
  readonly y: number;
  readonly key: string;
}

/** Options controlling how a pointer sweep searches for a pick target. */
export interface SweepOptions {
  /** Only accept hits whose dataset key starts with this prefix (default: any). */
  readonly prefix?: string;
  /** Which canvas dataset attribute carries the hit key (default: `"pick"`). */
  readonly attribute?: "pick" | "hovered";
  /** Rows in the fractional grid (default: 8). */
  readonly rows?: number;
  /** Columns in the fractional grid (default: 10). */
  readonly cols?: number;
  /**
   * Max milliseconds to poll after each move for async GPU pick readback
   * (default: 250).
   */
  readonly settleMs?: number;
  /** Sweep from the bottom-right toward the top-left (for edge-near targets). */
  readonly reverse?: boolean;
  /** When set, scan with a fixed pixel step instead of the fractional grid. */
  readonly step?: number;
  /** Clear the diagnostic before every move so returned coordinates are exact. */
  readonly fresh?: boolean;
}

/** A canvas-local CSS rectangle used by the devtools region query. */
export interface RegionRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}
