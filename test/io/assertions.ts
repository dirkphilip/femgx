import { expect } from "vitest";

/**
 * Asserts that a possibly-undefined value is defined and narrows its type, so
 * tests can avoid non-null assertions (which the lint gate forbids).
 */
export function required<T>(value: T | undefined): T {
  expect(value).toBeDefined();
  return value as T;
}
