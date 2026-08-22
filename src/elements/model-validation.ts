/** Machine-readable failure from the authoritative element-model boundary. */
export type ElementModelValidationCode =
  | "duplicate-element-id"
  | "invalid-body-id"
  | "duplicate-body-id"
  | "body-order"
  | "empty-body"
  | "unknown-body-element"
  | "duplicate-body-membership";

/** Typed validation error for an invalid authored element model. */
export class ElementModelValidationError extends Error {
  /** Machine-readable model validation code. */
  readonly code: ElementModelValidationCode;

  constructor(code: ElementModelValidationCode, message: string) {
    super(message);
    this.name = "ElementModelValidationError";
    this.code = code;
  }
}
