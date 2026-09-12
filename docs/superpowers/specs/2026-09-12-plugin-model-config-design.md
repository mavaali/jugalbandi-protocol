# Per-role model configuration for the Jugalbandi plugin

**Date:** 2026-09-12
**Status:** Design, approved for planning

## Problem

Every role in the Jugalbandi plugin — Proposer, Challenger, Resolver, Reviewer — runs as a
Claude Code subagent, which means every role runs on the same model family. Context
isolation is the protocol's mechanism, but a single model arguing with itself under
isolation still shares one set of training biases. H3 in `commitment/hypotheses.md` claims
the assumption-surfacing gap is not Claude-specific; nothing in the plugin can currently
test that claim, because there is no way to put a different model in a role.

This spec adds per-role model assignment, including cross-provider assignment via the Codex
and Gemini CLIs.

## Goals

- Assign each role a model, per project and per run.
- Support providers other than Anthropic, using each vendor's own agentic CLI rather than a
  hand-rolled tool-calling loop.
- Preserve today's behavior exactly when nothing is configured.
- Record which model played which role, so a run's artifacts remain a complete audit trail.
- Hold the isolation guarantee across providers, or state precisely where it weakens.

## Non-goals

- Selecting among Claude tiers (`opus`/`sonnet`/`haiku`) per role. The subagent frontmatter
  `model:` field already exists for that; this spec does not use it. `claude` means "the
  native subagent, as today."
- Swapping a role's model between round 1 and round 2 of a `--rounds 2` run.
- Changing `src/runner.ts` or the benchmark harness.
- Managing provider authentication. Codex and Gemini CLI auth is a user prerequisite.

## Explicit non-claim

A cross-provider run conflates two mechanisms: role-structured isolation and model diversity.
This spec makes the H3 test runnable. It does not make its result clean. A cross-provider run
showing a larger assumption-surfacing gap is not evidence about isolation specifically,
because model diversity alone could produce it. Separating them needs an ablation this spec
does not provide, and anything written up from these runs must say so.

## The isolation problem

This is the load-bearing section. The rest of the design is plumbing.

A Claude Code subagent's isolation is enforced by the harness: it starts with no context
beyond the prompt it is handed, and no amount of sloppy prompting can leak the Proposer's
reasoning into the Challenger. An external CLI carries no such guarantee. It is a full agent
harness with its own ideas about what context a session should start with.

**[DATA] Measured in this session, `codex-cli 0.154.0`.** A scratch repo containing an
`AGENTS.md` that named a task and a marker string `ZANZIBAR-7`. Invoked with
`codex exec --sandbox read-only` and the prompt *"What is the magic word for this project,
and what task is currently in progress? If you do not know, reply exactly UNKNOWN. Do not
read any files."* Codex replied: *"The magic word is ZANZIBAR-7. The current task is adding
rate limiting to the payments service using a token bucket algorithm."*

It loaded the file before the prompt arrived. A read-only sandbox did not prevent it, and an
explicit instruction not to read files did not prevent it, because no file read happened at
prompt time — the content was already in context.

The consequence is direct: a Codex Challenger, in any repo that has an `AGENTS.md`, receives
a description of the task it is specifically forbidden to see. `plan/SKILL.md` line 74 says
"Do not add the task. Do not add context. This prompt is the whole prompt." The adapter would
honor that in the string it builds and the CLI would violate it underneath. The run would
look like a Jugalbandi run and would actually be self-critique with extra steps — the exact
baseline the protocol is measured against. Nothing in the output would reveal this.

This repo has no `AGENTS.md` today. That is not a defense: the plugin is designed to be
installed into other repositories, and a repo with agent instruction files is the normal case
for the audience this plugin has.

**[DATA] Two further findings from the same probes.** `codex exec` printed *"Reading
additional input from stdin..."* — inherited stdin is an additional uncontrolled input, not
merely untidy. And `gemini 0.59.0` exited **code 0** having done nothing, printing *"Approval
mode overridden to 'default' because the current folder is not trusted"* and an
authentication error. Exit status is not a success signal for either CLI.

**[HYPOTHESIS] Gemini's ambient loading was not measured**, because the CLI is not
authenticated on this machine. [TRAINING] It loads `GEMINI.md` hierarchically and, per its own
help text, "If not provided, all extensions are used." Treat it as leaking until measured.

### Requirement: ambient context neutralization

The adapter MUST start each external role from a context containing nothing but the prompt it
was given. Concretely, every invocation:

- Disables project and user instruction files (`AGENTS.md`, `GEMINI.md`, and their
  hierarchical parents).
- Disables user config, profiles, extensions, MCP servers, and hooks.
  [DATA] Codex exposes `--ignore-user-config`, `--ignore-rules`, and `-c key=value`.
  [DATA] Gemini exposes `-e/--extensions` and `--allowed-mcp-server-names`.
- Starts a fresh, non-resumable, non-persisted session.
  [DATA] Codex exposes `--ephemeral`; both CLIs have opt-in `resume`/`--session-file` which
  must simply never be passed.
- Passes the prompt as an argv element or over an explicitly-controlled stdin, never both,
  and never inherits the parent's stdin.
- [DATA] For Gemini, passes `--skip-trust`, or `--approval-mode` is silently overridden.

The exact flag set is an implementation detail; the requirement is the property. **The
planner must treat the probe below as the acceptance criterion, not the flag list** — a flag
set that does not pass the probe is wrong no matter how plausible it reads.

### Accepted divergence: shell access

The native roles declare `tools: Read, Grep, Glob, Write` — no Bash. [TRAINING] Codex
performs file edits through a shell/apply-patch tool, so any sandbox permissive enough to let
a role write its output file also permits arbitrary command execution in the workspace. A
Codex Challenger could run `git log` or `git diff` and reconstruct the task it was not given.

This is unavoidable given the vehicle: a role that can write a file in a repo can read that
repo. The spec accepts it rather than pretending otherwise, with two consequences the
implementation must honor:

1. The run report and `RUN/models.json` record which roles ran externally, so a reader knows
   that for those roles isolation was prompt-level and workspace-bounded, not structural.
2. The README's existing framing — "half the isolation is structural... the other half is
   still discipline" — extends to say that for external roles, less of it is structural.

## Design

### Config file

`.jugalbandi.json` at the project root — a sibling of `.env`, deliberately distinct from the
`.jugalbandi/<slug>/` per-run artifact directories.

```json
{
  "models": {
    "proposer": "claude",
    "challenger": "codex",
    "resolver": "codex:gpt-5.1-codex",
    "reviewer": "claude"
  }
}
```

A value is `<provider>` or `<provider>:<model>`, split on the first colon. Providers are
`claude`, `codex`, `gemini`. Omitting the model half means that CLI picks its own default.

A missing file, a missing `models` key, or a missing role key all resolve to `claude`. A
project that never creates this file behaves exactly as the plugin does today.

`claude:<anything>` is a hard error, not a silent truncation. Per-role Claude tier selection
is a stated non-goal, and accepting the string while ignoring half of it would imply support
that does not exist.

### Per-invocation override

`/jugalbandi:plan` accepts `--proposer=`, `--challenger=`, and `--resolver=` flags:

```
/jugalbandi:plan Add multi-region failover --challenger=codex --resolver=gemini:gemini-2.5-pro
```

Parsed and stripped from the task text the same way `--rounds 2` already is, before the
remaining text reaches the Proposer. A flag overrides the config file for that run only.

`/jugalbandi:challenge` and `/jugalbandi:review` read the config file's `challenger` and
`reviewer` entries but gain no flags. A config value that half the plugin ignored would be a
footgun, so the file applies everywhere; the override flags exist only where the audit-trail
machinery already does.

### Provider adapter

`plugins/jugalbandi/scripts/run-role.mjs` — plain ESM, Node built-ins only, no npm
dependencies, bundled inside the plugin so it travels when the plugin is installed elsewhere.

Arguments: `--role`, `--provider`, `--model` (optional), `--cwd`, `--output`, `--timeout`,
plus the role's inputs (`--task` for proposer; `--input` for challenger and reviewer;
`--proposal` and `--challenges` for resolver; `--decisions` optionally for reviewer).

Behavior:

1. Resolve `agents/<role>.md` relative to the script's own location via `import.meta.url`
   (`../agents/<role>.md`). The script must not depend on the process working directory or on
   any environment variable to find its own package — it runs with `cwd` set to the target
   project, which is a different tree entirely.
2. Strip the YAML frontmatter; the body is the role instructions.
3. Build the same isolated user message the native-subagent path sends for that role, copied
   verbatim from the SKILL.md prose. The Challenger's is `Read <path>. That file is the
   entire proposal under review — it is all the context you get. Write your challenges to
   <output>.`
4. Concatenate instructions and message into one prompt. Neither CLI exposes a separate
   system-prompt channel, so the role definition rides in the single prompt.
5. Spawn the CLI with `execFile`-style argv — never an interpolated shell string, because a
   prompt containing a backtick or `$` would otherwise be a quoting bug or worse. Child
   `cwd` is the project root; [DATA] Gemini has no `--cd` equivalent, so the child's working
   directory is the only mechanism, and Codex's `-C` is passed for parity rather than
   necessity. Stdin is not inherited.
6. Enforce `--timeout` (default 10 minutes). On expiry, kill the child and exit non-zero.
7. Verify the output file exists and is non-empty. **Do not trust the exit code** — [DATA]
   Gemini returns 0 on an auth failure that produced no work. The written artifact is the
   only success signal.

### Conductor branch

The SKILL.md prose gains one decision per role: if the resolved model is `claude`, launch the
native subagent exactly as today. Otherwise run `run-role.mjs` via Bash with that role's
existing input and output paths.

Either way the conductor reads the resulting artifact file to build the reported tally. It
does not parse a free-text summary from the CLI. The role `.md` files specify an output
contract for their final message, and a Claude subagent is bound by that contract as its
persona; an external model receives the same words as ordinary prompt text and may or may not
comply.

**Script path resolution.** [HYPOTHESIS] Claude Code exposes `${CLAUDE_PLUGIN_ROOT}` to
plugin skills; this was not verified in this session and no installed plugin in the local
cache uses it. The implementation must verify it, including in a headless `-p` run, before
depending on it. The three SKILL.md files already carry a hard-won warning that
`$CLAUDE_PROJECT_DIR` is unset headless and expands to the filesystem root
(`plan/SKILL.md` 48–50, `review/SKILL.md` 29–30); this is the same class of bug and must not
be repeated. If no reliable variable exists, the conductor locates the script by a documented
convention and fails loudly when it is absent — never by silently skipping the external role.

**Frontmatter.** All three skills declare narrow Bash allowlists
(`Bash(mkdir -p *), Bash(date *)` in plan; `Bash(mkdir -p *)` in challenge; the git set in
review). The new branch needs to invoke Node and read `.jugalbandi.json`, so `allowed-tools`
must be widened accordingly. In a headless run an unpermitted Bash call is denied rather than
prompted — precisely the mode `plan/SKILL.md` step 7 goes out of its way to support.

### Data flow — `/jugalbandi:plan`

1. Resolve the assignment: config file, then flags. Reject unknown providers and
   `claude:<model>` here, before anything launches.
2. Write the resolved map to `RUN/models.json` before launching any role, so a run that dies
   partway still records what it was configured to do.
3. Run Proposer, Challenger, Resolver in the existing order, each through its branch. The
   artifact contract is unchanged: `RUN/proposal.md`, `RUN/challenges.md`,
   `RUN/final-plan.md`, whichever model produced them.
4. `--rounds 2` reuses each role's round-1 model.
5. The step 6 report gains one line, naming external roles explicitly so the weaker isolation
   guarantee is visible in the report and not only in a file:
   `Models: proposer=claude, challenger=codex (external), resolver=gemini:gemini-2.5-pro (external) — RUN/models.json`

### Data flow — `/jugalbandi:challenge`, `/jugalbandi:review`

Same branch, keyed off the config file's `challenger` and `reviewer` entries. No override
flags, no `models.json` — neither skill has the round or audit-trail machinery that file
belongs to.

## Error handling

| Condition | Behavior |
|---|---|
| Unknown provider, or `claude:<model>`, in config or flag | Stop before launching any role; report the offending value |
| `codex`/`gemini` not on `PATH` | Stop; report the missing binary and which role wanted it |
| Adapter exits non-zero | Stop; report the captured stdout/stderr tail |
| Timeout expires | Kill the child; stop; report the timeout and the role |
| Output file missing or empty | Treated as model failure; stop and report — regardless of exit code |

No condition falls back to `claude` silently. A silent substitution would make
`RUN/models.json` a false record, which is worse than a failed run — the file's only purpose
is to say what actually happened. This mirrors `/jugalbandi:review`'s existing behavior of
stopping when the project's own checks fail rather than proceeding on a broken foundation.

## Testing

**The isolation probe is the acceptance test for this feature.** Everything else is
secondary, because everything else failing produces a visibly broken run, while this failing
produces a run that looks correct and is not.

- **Isolation probe (required, blocking):** a scratch repo containing an `AGENTS.md` and a
  `GEMINI.md` that name a task and a marker string. Run the Challenger role through the
  adapter against a proposal that does not mention the marker. Assert the marker appears
  nowhere in `challenges.md`, and assert the reproduction case — the same invocation without
  the neutralization flags — does leak it. A probe that cannot demonstrate the failure it
  guards against is not evidence the guard works. Run for each supported provider.
- **Adapter, direct:** output file written and non-empty on success; non-zero exit on a
  deliberately failing run; non-zero on a run whose CLI exits 0 without writing; timeout kills
  the child.
- **Regression:** `/jugalbandi:plan` with no config file and no flags. Artifacts and report
  must match today's shape exactly.
- **Mixed assignment:** `/jugalbandi:plan --challenger=codex` against one of the five
  benchmark tasks. Confirm `RUN/models.json`, all three artifacts, and the report's model
  line.
- **Failure path:** a config naming a provider whose binary is absent. Confirm the run stops
  and names the missing binary rather than silently running on Claude.
- **Headless:** at least the regression and one mixed-assignment case under `claude -p`,
  where unpermitted Bash is denied rather than prompted and a hang is unbounded.

## Consequences

`.jugalbandi.json` becomes a checked-in project file; `.jugalbandi/` remains git-ignored
artifact output. The plugin gains a Node runtime dependency, but only on the path where a
non-Claude provider is configured — an all-`claude` project never executes the script.

The plugin takes on a maintenance burden it did not have: two external CLIs whose default
context-loading behavior can change between versions, in a direction that silently weakens
the protocol rather than breaking it. The isolation probe is the only thing standing between
a CLI upgrade and a quietly invalid run, which is why it belongs in CI rather than in a
one-time manual check.
