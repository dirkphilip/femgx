# CI authority

GitHub's required checks are the authoritative merge gate. Local validation
provides feedback before publication, but it does not replace the checks
configured in `.github/workflows/ci.yml`.

## Merge decision

- **Pending or missing checks** keep a pull request unmergeable.
- **Failing checks** must be repaired before merge.
- **Successful required checks** allow GitHub to merge once any required review
  and branch-protection conditions are also satisfied.

## Base health

Before starting substantial feature work, check that the target base branch is
healthy. If its required checks are failing, prioritize repairing the base and
re-run the full CI gate before building unrelated work on top of it.
