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
and Antigravity CLIs.

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
- Managing provider authentication. External CLI auth is a user prerequisite.
- Supporting the `gemini` CLI. See "Why not Gemini CLI" below.

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

**[DATA] `codex exec` also printed "Reading additional input from stdin..."** — inherited
stdin is an additional uncontrolled input, not merely untidy.

**[HYPOTHESIS] Antigravity's ambient loading is unmeasured.** The CLI is not installed on this
machine. It is a Gemini-family agent harness and should be assumed to load context files by
default until a probe says otherwise.

### Requirement: ambient context neutralization

The adapter MUST start each external role from a context containing nothing but the prompt it
was given. Concretely, every invocation:

- Disables project and user instruction files (`AGENTS.md` and equivalents, including their
  hierarchical parents).
- Disables user config, profiles, extensions, MCP servers, and hooks.
  [DATA] Codex exposes `--ignore-user-config`, `--ignore-rules`, and `-c key=value`.
- Starts a fresh, non-resumable, non-persisted session.
  [DATA] Codex exposes `--ephemeral`; `resume`/`fork` are opt-in and must never be passed.
- Passes the prompt as an argv element or over an explicitly-controlled stdin, never both,
  and never inherits the parent's stdin.

The exact flag set is an implementation detail; the requirement is the property. **The
planner must treat the probes below as the acceptance criterion, not the flag list** — a flag
set that does not pass them is wrong no matter how plausible it reads.

### External roles do not write

An earlier draft required a write-permissive sandbox so each role could write its own
artifact. That forced a permission grant wide enough to reopen the channels the
neutralization requirement closes. The discovery came from the Gemini CLI, which is no longer
a supported provider but whose behavior produced the insight worth keeping:

**[DATA]** In `@google/gemini-cli` `bundle/chunk-LZ4UWPZ4.js`, workspace trust gates
workspace-scoped configuration loading — `const safeWorkspace = isTrusted ? workspace : {}`
(16193), `this.workspace = isTrusted ? workspace : this.createEmptyWorkspace(workspace)`
(16211), `loadEnvironment(settings, workspaceDir, isWorkspaceTrustedFn)` (16459). *Untrusted*
is the state in which workspace settings are replaced with an empty object. The flag that
grants write permission is therefore also the flag that turns workspace config loading back
on. Two requirements that each looked correct cancelled each other out.

The fix is to remove the need for the grant entirely:

**An external role produces its artifact as its final message. The adapter writes the file.**

The adapter substitutes the role's `## Output contract` section with an external-role variant
instructing the model to return the full artifact content as its final message and write
nothing. The *content* contract is unchanged — what belongs in `challenges.md` is identical
either way; only delivery differs.

This collapses the permission requirement to read-only on every provider:

- Codex runs `--sandbox read-only`, capturing the artifact via
  [DATA] `-o/--output-last-message <FILE>`.
- Antigravity runs headless, capturing the artifact from stdout.
  [DATA] In headless mode the response goes to stdout and diagnostics — errors, auth prompts,
  progress, permission notices — go to stderr, and a tool requiring approval it cannot obtain
  is soft-denied rather than blocking. Both properties suit this design directly: clean
  capture without parsing, and no hang when a role attempts a write it no longer needs.

Nothing is lost. The Proposer still reads the codebase, and the Challenger still exercises
challenger.md's permission to "read the codebase to check whether the proposal's claims about
it are true." Only the write is gone, and the write was never the role's purpose.

### Accepted divergence: version-control archaeology

The native roles declare `tools: Read, Grep, Glob, Write` — no Bash. [DATA] The probe above
ran under `--sandbox read-only` and Codex executed commands anyway, so read-only removes
writes, not command execution. Tightening the sandbox further does not close this.

The delta over the native path is narrower than "can read the repo" — Read, Grep, and Glob
already allow that. It is specifically **version-control archaeology**: an external role can
run `git log`, `git diff`, or `git reflog` and reconstruct the task it was deliberately not
given, in a way the native tool set cannot. That is the concession, stated precisely rather
than softened.

The alternative — running external roles against a directory stripped of the repo — was
considered and rejected: it would break the Challenger's codebase-verification capability,
which is worth more than the divergence costs.

Two consequences the implementation must honor:

1. The run report and `RUN/models.json` record which roles ran externally, so a reader knows
   that for those roles isolation was prompt-level, not structural.
2. The substituted output-contract text also instructs external roles not to inspect version
   control. This is unenforceable, which is exactly why it belongs in the prompt rather than
   the sandbox: it moves task reconstruction from default agent behavior to observable
   disobedience. Nothing should be counted on it.

### Why not Gemini CLI

[DATA] `gemini 0.59.0` cannot be authenticated by signing in: it returns "This client is no
longer supported for Gemini Code Assist for individuals," directing users to Antigravity.
`GEMINI_API_KEY` and Vertex paths remain, but building a provider on a path its vendor is
actively deprecating buys a maintenance burden for a model reachable through Antigravity
anyway.

[DATA] One finding from it survives as a design constraint regardless of provider: `gemini`
exited **code 0** having done nothing, printing only an approval-override notice and an auth
error. **Exit status is not a success signal.** The written artifact is.

### Sequencing: Codex first, Antigravity gated

The isolation probes below are blocking, and an uninstalled CLI cannot be probed. Therefore:
**Codex ships in this plan. Antigravity does not.** Antigravity stays in the design — config
schema, adapter dispatch, capture strategy — but is not done until it is installed and its
probes pass. Shipping it behind an unrun probe would be shipping exactly the silent failure
this spec exists to prevent.

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
`claude`, `codex`, `antigravity`. Omitting the model half means that CLI picks its own
default.

A missing file, a missing `models` key, or a missing role key all resolve to `claude`. A
project that never creates this file behaves exactly as the plugin does today.

`claude:<anything>` is a hard error, not a silent truncation. Per-role Claude tier selection
is a stated non-goal, and accepting the string while ignoring half of it would imply support
that does not exist.

### Per-invocation override

`/jugalbandi:plan` accepts `--proposer=`, `--challenger=`, and `--resolver=` flags:

```
/jugalbandi:plan Add multi-region failover --challenger=codex --resolver=antigravity
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
3. Replace the body's `## Output contract` section with the external-role variant: return the
   full artifact as the final message, write no files, do not inspect version control.
4. Build the same isolated user message the native-subagent path sends for that role, copied
   verbatim from the SKILL.md prose, minus the "write your output to <path>" clause that no
   longer applies. The Challenger's is `Read <path>. That file is the entire proposal under
   review — it is all the context you get.`
5. Concatenate instructions and message into one prompt. No CLI here exposes a separate
   system-prompt channel, so the role definition rides in the single prompt.
6. Spawn the CLI with `execFile`-style argv — never an interpolated shell string, because a
   prompt containing a backtick or `$` would otherwise be a quoting bug or worse. Child `cwd`
   is the project root. Stdin is not inherited. Read-only permissions throughout, per
   "External roles do not write".
7. Enforce `--timeout` (default 10 minutes). On expiry, kill the child and exit non-zero.
8. Capture the artifact — Codex via `--output-last-message`, Antigravity from stdout — and
   write it to `--output`. An empty or missing final message is a failure.
9. Verify the written file is non-empty. **Do not trust the exit code.**
10. Record the resolved CLI version for the caller to store alongside the role assignment.

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
   partway still records what it was configured to do. After each external role completes,
   append the CLI version it ran on — the ambient-loading behavior this spec guards against is
   version-dependent, so an audit trail without versions cannot be re-examined after an
   upgrade.
3. Run Proposer, Challenger, Resolver in the existing order, each through its branch. The
   artifact contract is unchanged: `RUN/proposal.md`, `RUN/challenges.md`,
   `RUN/final-plan.md`, whichever model produced them.
4. `--rounds 2` reuses each role's round-1 model.
5. The step 6 report gains one line, naming external roles explicitly so the weaker isolation
   guarantee is visible in the report and not only in a file:
   `Models: proposer=claude, challenger=codex (external), resolver=antigravity (external) — RUN/models.json`

### Data flow — `/jugalbandi:challenge`, `/jugalbandi:review`

Same branch, keyed off the config file's `challenger` and `reviewer` entries. No override
flags, no `models.json` — neither skill has the round or audit-trail machinery that file
belongs to.

## Error handling

| Condition | Behavior |
|---|---|
| Unknown provider, or `claude:<model>`, in config or flag | Stop before launching any role; report the offending value |
| CLI binary not on `PATH` | Stop; report the missing binary and which role wanted it |
| Adapter exits non-zero | Stop; report the captured stderr tail |
| Timeout expires | Kill the child; stop; report the timeout and the role |
| Final message empty, or written file empty | Treated as model failure; stop and report — regardless of exit code |

No condition falls back to `claude` silently. A silent substitution would make
`RUN/models.json` a false record, which is worse than a failed run — the file's only purpose
is to say what actually happened. This mirrors `/jugalbandi:review`'s existing behavior of
stopping when the project's own checks fail rather than proceeding on a broken foundation.

## Testing

**The isolation probes are the acceptance test for this feature.** Everything else is
secondary, because everything else failing produces a visibly broken run, while these failing
produce a run that looks correct and is not. They belong in CI, not in a one-time manual
check: the isolation probe is the only thing standing between a CLI upgrade and a quietly
invalid run.

Two channels need separate probes, because neither detects the other.

- **Probe A — ambient context leaking in (required, blocking).** A scratch repo containing an
  `AGENTS.md` naming a task and a marker string. Run the Challenger role through the adapter
  against a proposal that does not mention the marker. Assert the marker appears nowhere in
  `challenges.md`, and assert the negative control — the same invocation without the
  neutralization flags — does leak it. A probe that cannot demonstrate the failure it guards
  against is not evidence the guard works.
- **Probe B — cross-role leaking between invocations (required, blocking).** Probe A cannot
  detect session persistence: a fresh scratch repo has no prior session, and one invocation
  creates no predecessor. Session persistence is the channel by which the Challenger's context
  would reach the Resolver, which is precisely the leak that turns a Jugalbandi run back into
  self-critique. Run two roles in sequence in the same scratch directory with a distinct
  marker planted only in role 1's *prompt* — in no file — and assert it appears nowhere in
  role 2's artifact. An implementer who neutralizes instruction files but omits `--ephemeral`
  passes Probe A cleanly and ships the adapter this spec exists to prevent.

Both probes run per provider. Codex's must pass before this ships; Antigravity's before it
is added.

**Channel coverage.** The neutralization requirement enumerates four channels; the probes
above cover repo instruction files and session persistence. The home-directory channel
(`$CODEX_HOME/config.toml`, `~/.codex/`) is invisible to a scratch-repo probe in clean CI and
will differ between CI and a developer machine — an adapter omitting `--ignore-user-config`
passes in CI and leaks locally. Either plant a marker per channel, or state in the
implementation which channels are flag-asserted rather than probe-verified. What is not
acceptable is leaving the distinction implicit, because the spec makes the probe the
acceptance criterion and unprobed bullets are then unenforced prose.

Remaining cases:

- **Adapter, direct:** artifact written and non-empty on success; non-zero exit on a
  deliberately failing run; non-zero when the CLI exits 0 without producing a final message;
  timeout kills the child.
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

The plugin takes on a maintenance burden it did not have: external CLIs whose default
context-loading behavior can change between versions, in a direction that silently weakens
the protocol rather than breaking it. That is why the probes live in CI and why
`RUN/models.json` records CLI versions — after an upgrade changes behavior, the audit trail
has to be able to answer which runs were affected.
