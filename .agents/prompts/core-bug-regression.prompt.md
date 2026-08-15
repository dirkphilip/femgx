---
name: core-bug-regression
description: Add regression-first feedback for a core-library bug fix.
---

Supplement the current bug-fix request with this sequence:

1. Add a focused regression test that demonstrates the bug.
2. Run it and confirm it fails for the expected reason.
3. Make the smallest fix.
4. Run the regression and focused checks again and confirm they pass.

Keep the user's request authoritative; add feedback rather than replacing it.
