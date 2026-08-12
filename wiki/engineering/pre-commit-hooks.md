# Pre-commit hooks

Husky owns the git `pre-commit` hook slot and composes two staged-file layers:
it runs lint-staged (eslint `--fix` and prettier) first, then the
[pre-commit framework](https://pre-commit.com) with `pre-commit run`. The
framework does not install its own git hook; only Husky owns
`.git/hooks/pre-commit`.

## Config

`.pre-commit-config.yaml` pins `pre-commit/pre-commit-hooks` and enables:

- `check-added-large-files` — block large blobs (default 500 KB).
- `check-case-conflict` — filename case-collision guard for case-insensitive
  filesystems.
- `check-json` / `check-yaml` — syntax validation (covers GitHub Actions
  workflow YAML too).
- `check-merge-conflict` — leftover conflict markers.
- `detect-private-key` — prevent accidental private-key commits.
- `end-of-file-fixer` — require final newline (matches `.editorconfig`).
- `trailing-whitespace` — trim trailing whitespace, with
  `--markdown-linebreak-ext=md` so double-space markdown hard breaks survive
  (matches `.editorconfig`, which disables trimming for `*.md`).

The hooks are deliberately check-only for code style: eslint/prettier already
enforce formatting, so pre-commit stays a validation layer that needs no Node
toolchain.

## Where it runs

Husky runs both layers locally on every normal commit. The `pre-commit` CLI is
a contributor prerequisite; install it with
`python3 -m pip install --user pre-commit`. If it is missing, the hook stops
with that setup command instead of silently skipping validation.

CI independently runs `pre-commit run --all-files` through
`.github/workflows/ci.yml` on every push/PR. Developers can run the same
full-repository check manually when needed.

## Gotchas

- `pre-commit run --all-files` auto-fixes `end-of-file-fixer` /
  `trailing-whitespace` violations and exits non-zero, so CI fails until the
  files are clean — run it once locally to apply the fixes before committing.
- Pre-commit only sees git-tracked files, so `node_modules`, `dist`, and
  `coverage` are excluded automatically.
- Keep `rev` tags current with `pre-commit autoupdate` (CI is green on the
  pinned versions).
