/**
 * How severe an issue is; errors make the result untrustworthy.
 * @category Import and export
 */
export type IssueSeverity = "error" | "warning" | "info";

/**
 * A position within a source document. Lines are 1-based.
 * @category Import and export
 */
export interface SourcePosition {
  /** One-based source line number. */
  readonly line: number;
  /** Optional one-based source column number. */
  readonly column?: number;
}

/**
 * A typed diagnostic produced during import, export, or model validation.
 * `code` is a stable machine-readable identifier (e.g. `"cell-type-count-mismatch"`)
 * and `message` is a human-readable, actionable description.
 * @category Import and export
 */
export interface Issue {
  /** Stable machine-readable issue code. */
  readonly code: IssueCode;
  /** Severity used to decide whether the result is trustworthy. */
  readonly severity: IssueSeverity;
  /** Human-readable actionable description. */
  readonly message: string;
  /** Optional source location. */
  readonly position?: SourcePosition;
}

/**
 * A stable, machine-readable diagnostic code.
 * @category Import and export
 */
export type IssueCode = string;

/**
 * Error thrown when an import or model validation fails. Carries the typed
 * issues that caused the failure so callers can react programmatically.
 * @category Import and export
 */
export class IoError extends Error {
  /** Diagnostics that caused or accompanied the failure. */
  readonly issues: readonly Issue[];
  constructor(message: string, issues?: readonly Issue[]) {
    super(message);
    this.name = "IoError";
    this.issues = issues ?? [];
  }
}
