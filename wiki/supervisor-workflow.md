# Supervisor workflow

Local issue-to-draft-PR workflow driven by Agent Supervisor (`sv`).

## Always launch with uvx

Never invoke `sv` from the agent-supervisor venv directly. Always launch it
through `uvx` so the tool resolves its own environment:

```sh
uvx --from agent-supervisor sv run 123
```

For interactive use, alias it:

```sh
alias sv='uvx --from agent-supervisor sv'
```

### Why

- No dependency on the local `agent-supervisor` checkout/venv; `uvx` pulls the
  published `agent-supervisor` package.
- Keeps the venv and repo out of the femgx workflow entirely.
- Always uses the latest published version of the tooling.

## Provider

The supervisor runs agents with the `opencode` provider
(`.supervisor/config.toml`, overridable per machine in
`.supervisor/config.local.toml`), using model `opencode-go/deepseek-v4-flash`.
`opencode` must be installed and authenticated before a run.

## Useful commands

```sh
sv run 123            # pull (if needed) and run one issue
sv run                # process up to max_issues_per_run
sv run --detach       # keep the workflow running in the background
sv status             # stopped / running / pausing
sv job status --json  # per-job state (prefer --json for scripts/agents)
sv stop               # interrupt workers and stop immediately
```

## Notes

- See `.supervisor/SKILL.md` for the full command reference and agent operating
  rules.
- Keep `.supervisor/config.local.toml`, `.supervisor/issues.json`, and
  `.supervisor/run/` local and ignored.
