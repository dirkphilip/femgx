/** Machine-readable geometry validation failure. */
export type GeometryValidationCode =
  | "invalid-body-id"
  | "duplicate-body-id"
  | "body-order"
  | "duplicate-body-membership"
  | "unknown-body-element"
  | "unknown-element-body"
  | "body-membership-mismatch"
  | "invalid-edge-key"
  | "duplicate-edge-key"
  | "invalid-edge-node-count"
  | "unknown-edge-element"
  | "unknown-edge-face";

/** Typed validation error raised for invalid geometry metadata. */
export class GeometryValidationError extends Error {
  /** Machine-readable validation code for programmatic handling. */
  readonly code: GeometryValidationCode;

  constructor(code: GeometryValidationCode, message: string) {
    super(message);
    this.name = "GeometryValidationError";
    this.code = code;
  }
}
