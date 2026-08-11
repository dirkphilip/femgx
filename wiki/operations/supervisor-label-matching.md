# Supervisor label matching

How configured `github.allow_labels` and `github.ignore_labels` match GitHub
issue labels, and the migration behavior around the fix.

## Effective configuration

Configured intake labels are matched **exactly as written**; the supervisor does
not apply its managed namespace prefix (`sv:`) to them:

- A bare label such as `ready-for-supervisor` matches the GitHub label
  `ready-for-supervisor`.
- A fully qualified label such as `team:ready` matches that exact GitHub label.
- `ignore_labels` take precedence over `allow_labels`: an issue carrying any
  ignore label is never auto-pulled, even when it also carries an allow label.
- When `allow_labels` is non-empty, an open unassigned issue is auto-pulled only
  if it carries at least one allow label.

The committed `.supervisor/config.toml` uses the bare `ready-for-supervisor`
approval label; the config contract is guarded by
`test/supervisor/supervisor-label-config.test.ts`.

## Background and migration

With `github.auto_pull = true` and `github.allow_labels = ["ready-for-supervisor"]`,
approved issues were not auto-claimed: the approval-label gate resolved the
configured bare label through the supervisor namespace (`sup:`), matching
`sup:ready-for-supervisor` instead of the shared GitHub label
`ready-for-supervisor`. Explicit `sv run ISSUE` bypasses the gate and worked.

The fix makes configured allow/ignore labels match literally (tracked upstream
at dirkphilip/sv#254 "Do not implicitly prefix configured allow/deny labels").
Migration for existing configurations:

- Keep the bare form: `allow_labels = ["ready-for-supervisor"]` now matches the
  GitHub label `ready-for-supervisor`.
- Configurations that previously spelled out a namespaced label, for example
  `allow_labels = ["sup:ready-for-supervisor"]` to match a GitHub label literally
  named `sup:ready-for-supervisor`, must drop the `sup:` prefix after upgrading
  so the meaning is unchanged.
- Lifecycle labels owned by the supervisor use the configured `sv:` namespace;
  that is unrelated to user allow/ignore labels. Older `sup:*` lifecycle labels
  are stale historical labels and should be removed after migration.

## Verification

- Config-level regression coverage: `npm test -- test/supervisor/supervisor-label-config.test.ts`.
- End-to-end (once the upstream fix is running): create an open, unassigned test
  issue, add the approval label
  (`gh issue edit ISSUE --add-label ready-for-supervisor`), start a detached run
  with `sv run --detach`, and confirm the supervisor auto-claims the issue.
  Runtime state stays under `.supervisor/run/`; never expose the local control
  token or runtime URL.

Related: [[operations/supervisor-workflow|Supervisor workflow]].

[operations/supervisor-workflow|Supervisor workflow]: supervisor-workflow.md
