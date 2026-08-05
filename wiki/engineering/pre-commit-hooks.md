# Pre-commit hooks

The repo uses two hook layers. Husky owns the git `pre-commit` hook slot and
runs lint-staged (eslint `--fix`, prettier, merge-conflict markers) on staged
files via `npm run pre-commit`. The [pre-commit framework](https://pre-commit.com)
adds popular validators on top without installing its own git hook (only one
tool can own `.git/hooks/pre-commit`).

## Config

`.pre-commit-config.yaml` pins `pre-commit/pre-commit-hooks` and enables:

- `check-added-large-files` — block large blobs (default 500 KB).
- `check-case-conflict` — filename case-collision guard for case-insensitive
  filesystems.
- `check-json` / `check-yaml` — syntax validation (covers GitHub Actions
  workflow YAML too).
- `check-merge-conflict` — leftover conflict markers (belt-and-suspenders next
  to the lint-staged merge-conflict check).
- `detect-private-key` — prevent accidental private-key commits.
- `end-of-file-fixer` — require final newline (matches `.editorconfig`).
- `trailing-whitespace` — trim trailing whitespace, with
  `--markdown-linebreak-ext=md` so double-space markdown hard breaks survive
  (matches `.editorconfig`, which disables trimming for `*.md`).

The hooks are deliberately check-only for code style: eslint/prettier already
enforce formatting, so pre-commit stays a validation layer that needs no Node
toolchain.

## Where it runs

Pre-commit runs in CI (`.github/workflows/ci.yml`, `pre-commit/action@v3.0.1`
→ `pre-commit run --all-files`) on every push/PR. It is NOT installed as a git
hook locally because husky owns that slot. Developers with `pre-commit`
installed can run `pre-commit run --all-files` manually for local feedback.

## Gotchas

- `pre-commit run --all-files` auto-fixes `end-of-file-fixer` /
  `trailing-whitespace` violations and exits non-zero, so CI fails until the
  files are clean — run it once locally to apply the fixes before committing.
- Pre-commit only sees git-tracked files, so `node_modules`, `dist`, and
  `coverage` are excluded automatically.
- Keep `rev` tags current with `pre-commit autoupdate` (CI is green on the
  pinned versions).
