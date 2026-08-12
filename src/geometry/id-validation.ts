/** Largest direct `u32` identity accepted for a reusable part. */
export const MAX_PART_ID = 0xffff_ffff;

/** Largest raw identity that can be encoded as a one-based pick id. */
export const MAX_ONE_BASED_ID = MAX_PART_ID - 1;

/** Returns whether an identity survives one-based `u32` pick encoding. */
export function isValidOneBasedId(id: number): boolean {
  return Number.isSafeInteger(id) && id >= 0 && id <= MAX_ONE_BASED_ID;
}

/** Validates an identity that is written to a one-based `u32` pick field. */
export function validateOneBasedId(id: number, label: string): void {
  if (!isValidOneBasedId(id)) {
    throw new Error(`${label} id ${id} must be a finite integer in [0, ${MAX_ONE_BASED_ID}]`);
  }
}

/** Validates a direct `u32` part identity before it enters scene ownership. */
export function validatePartId(id: number): void {
  if (!Number.isSafeInteger(id) || id < 0 || id > MAX_PART_ID) {
    throw new Error(`Part id ${id} must be a finite integer in [0, ${MAX_PART_ID}]`);
  }
}
