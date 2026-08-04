---
name: quality-gate
description: Run the full femgx quality gate during review or final integration: typecheck, lint, unit tests with coverage, format, and Playwright e2e. Implementation and repair workers use focused checks instead.
---

# Review quality gate

Run this gate once during the reviewer stage or final integration from the repo
root. Implementation and repair workers must follow
`.supervisor/WORKER_PROTOCOL.md` and use focused checks instead.

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
