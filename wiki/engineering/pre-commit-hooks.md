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
- `check-toml` — syntax validation for committed TOML configuration files.
- `check-merge-conflict` — leftover conflict markers.
- `detect-private-key` — prevent accidental private-key commits.
- `end-of-file-fixer` — require final newline (matches `.editorconfig`).
- `trailing-whitespace` — trim trailing whitespace, with
  `--markdown-linebreak-ext=md` so double-space markdown hard breaks survive
  (matches `.editorconfig`, which disables trimming for `*.md`).
- The local `actionlint` hook — validate GitHub Actions workflow semantics
  with the pinned release used by `scripts/actionlint.mjs`.
- The pinned `codespell` hook — check repository-owned prose and source text
  for common misspellings without rewriting files.

`check-yaml` remains the general YAML syntax owner. `actionlint` validates
workflow semantics, expressions, action inputs, job dependencies, and runner
labels. `scripts/check-github-actions.mjs` remains the separate owner of the
repository's stricter full-commit-SHA policy for external actions.

Codespell scans tracked text files, including Markdown, TypeScript/JavaScript,
configuration, and scripts. It deliberately excludes `package-lock.json`, VTK
fixtures, and binary GLB fixtures. Its only allowlisted term is `afterall`, the
camel-case Vitest lifecycle API `afterAll`; domain terms and public identifiers
are fixed or excluded only when the baseline demonstrates that they are not
ordinary prose.

The hooks are deliberately check-only for code style: eslint/prettier already
enforce formatting, so pre-commit stays a validation layer. The local
actionlint hook uses the repository's existing Node runtime and adds no global
tool prerequisite.

## Where it runs

Husky runs both layers locally on every normal commit. The `pre-commit` CLI is
a contributor prerequisite; install it with
`python3 -m pip install --user pre-commit`. If it is missing, the hook stops
with that setup command instead of silently skipping validation.

CI independently runs `pre-commit run --all-files` through
`.github/workflows/ci.yml` on every push/PR. Developers can run the same
full-repository check manually when needed.

To run only semantic workflow validation, use `npm run lint:actionlint`.

## Gotchas

- `pre-commit run --all-files` auto-fixes `end-of-file-fixer` /
  `trailing-whitespace` violations and exits non-zero, so CI fails until the
  files are clean — run it once locally to apply the fixes before committing.
- Pre-commit only sees git-tracked files, so `node_modules`, `dist`, and
  `coverage` are excluded automatically.
- The first actionlint run downloads the pinned v1.7.12 macOS/Linux archive,
  verifies its platform-specific SHA-256 checksum, and caches the executable
  under ignored `.cache/actionlint/`. No Go, Docker, ShellCheck, or Pyflakes
  installation is required; the optional ShellCheck/Pyflakes integrations are
  explicitly disabled for deterministic results.
- To upgrade actionlint, update `version` and every supported platform
  checksum in `scripts/actionlint.mjs`, clear `.cache/actionlint/`, run
  `npm run lint:actionlint`, and record the release in this note.
- To upgrade codespell, update its immutable `rev` in `.pre-commit-config.yaml`,
  run `pre-commit autoupdate` only for the intended hook, review new baseline
  findings, and keep any allowlist additions narrow and explained.
- Keep `rev` tags current with `pre-commit autoupdate` (CI is green on the
  pinned versions).
