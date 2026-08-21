/** Returns a string control value only from an event with a value-bearing current target. */
export function controlValue(event: unknown): string | undefined {
  if (typeof event !== "object" || event === null || !("currentTarget" in event)) {
    return undefined;
  }
  const currentTarget = event.currentTarget;
  if (typeof currentTarget !== "object" || currentTarget === null || !("value" in currentTarget)) {
    return undefined;
  }
  return typeof currentTarget.value === "string" ? currentTarget.value : undefined;
}
