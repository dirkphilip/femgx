---
name: quality-gate
description: Run the full femgx quality gate during final integration or CI parity checks: typecheck, lint, unit tests with coverage, performance budget, format, build, package smoke, and Playwright e2e. Specialized implementation, review, and repair workers use focused checks instead; CI owns the full product gate.
---

# Full quality gate

Run this gate only during final integration or an explicit CI-parity check from
the repo root. Specialized implementation, review, and repair workers must use
focused checks instead. The reviewer
records focused local validation but is not a merge authority; GitHub's required
checks decide mergeability (see `wiki/operations/ci-authority.md`).

```sh
npm run typecheck
npm run lint
npm run test:coverage
npm run bench:budget
npm run format
npm run build
npm run test:package
npm run test:e2e:ci
```

## What each command checks

- `typecheck` — `tsc --noEmit` with strict flags.
- `lint` — ESLint flat config, `strictTypeChecked` ruleset, `--max-warnings 0`.
  Covers `src/`, `test/`, `demo/`, `e2e/`.
- `test:coverage` — Vitest unit tests with v8 coverage; **thresholds are
  enforced**: lines/functions 80%, branches 70%. Do not lower them to pass;
  add tests or remove uncovered dead code instead.
- `format` — Prettier write. Leave the repo formatted.
- `build` — type-check + bundle library (emits `dist/` with `.d.ts`).
- `test:package` — builds, packs the library, and validates a clean consumer
  install.
- `test:e2e:ci` — Playwright's hosted no-GPU unsupported-contract smoke. The
  real system-Chrome WebGPU lane is `npm run test:e2e` when rendering, camera,
  interaction, demo, or responsive-layout changes require it.

## Coverage policy

Missing coverage is a dead-code audit lead, not a reason to pad tests.
Prefer deleting genuinely unused paths over writing tests that only inflate
the percentage.

## Notes

- CI runs the same gate (`.github/workflows/ci.yml`) on every push/PR, so CI is
  the authoritative result; a local run is a parity check, not a merge gate.
- Playwright setup installs both system Chrome and Chromium:
  `npm run test:e2e:install`.
