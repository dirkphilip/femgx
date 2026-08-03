---
name: quality-gate
description: Run the full femgx quality gate before finishing any change: typecheck, lint, unit tests with coverage, format, and Playwright e2e. Use when a change touches src, test, demo, or e2e, and before any handoff/PR.
---

# Quality Gate

Every femgx change must pass the full gate. Run these from the repo root:

```sh
npm run typecheck
npm run lint
npm run test:coverage
npm run format
npm run test:e2e
```

## What each command checks

- `typecheck` — `tsc --noEmit` with strict flags.
- `lint` — ESLint flat config, `strictTypeChecked` ruleset, `--max-warnings 0`.
  Covers `src/`, `test/`, `demo/`, `e2e/`.
- `test:coverage` — Vitest unit tests with v8 coverage; **thresholds are
  enforced**: lines/functions 80%, branches 70%. Do not lower them to pass;
  add tests or remove uncovered dead code instead.
- `format` — Prettier write. Leave the repo formatted.
- `test:e2e` — Playwright against the local dev server (`e2e/`).

## Coverage policy

Missing coverage is a dead-code audit lead, not a reason to pad tests.
Prefer deleting genuinely unused paths over writing tests that only inflate
the percentage.

## Notes

- CI runs the same gate (`.github/workflows/ci.yml`), so the gate must pass
  locally before pushing.
- Playwright needs the Chromium browser once: `npm run test:e2e:install`.
