/**
 * Thrown when a viewport visibility mutation receives an unknown scene id.
 * @category Viewport lifecycle
 */
export class UnknownSceneIdentityError extends Error {
  /** Identity category that was not found. */
  readonly kind: "part" | "assembly" | "assembly-occurrence" | "instance";
  /** Missing stable id supplied to the visibility operation. */
  readonly id: number | string;

  constructor(kind: UnknownSceneIdentityError["kind"], id: UnknownSceneIdentityError["id"]) {
    super(`Unknown ${kind} identity ${String(id)} in the active viewport scene`);
    this.name = "UnknownSceneIdentityError";
    this.kind = kind;
    this.id = id;
  }
}
