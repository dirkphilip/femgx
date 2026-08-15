import type { FullConfig, FullResult, Reporter, Suite } from "@playwright/test/reporter";

/**
 * Prints a skip summary at the end of a run so capability-gated tests are
 * visible and reviewable in CI output. The built-in `list` reporter marks
 * skipped tests with `-` but does not show why; this reporter groups the
 * reasons each skipped test annotated so a silent pass can never be mistaken
 * for a clean required-journey run.
 */
export default class SkipSummaryReporter implements Reporter {
  private suite: Suite | undefined;

  onBegin(_config: FullConfig, suite: Suite): void {
    this.suite = suite;
  }

  onEnd(_result: FullResult): void {
    const counts = new Map<string, number>();
    if (this.suite !== undefined) this.collect(this.suite, counts);
    if (counts.size === 0) {
      console.log("Skip summary: no tests skipped.");
      return;
    }
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
    console.log(`Skip summary: ${total} skipped by reason:`);
    for (const [reason, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  [${count}] ${reason}`);
    }
  }

  private collect(suite: Suite, counts: Map<string, number>): void {
    for (const child of suite.suites) this.collect(child, counts);
    for (const test of suite.tests) {
      if (test.outcome() !== "skipped") continue;
      const reason = test.annotations.find((annotation) => annotation.type === "skip")?.description;
      const key = reason ?? "skipped without a reason";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
}
