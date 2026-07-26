# Jugalbandi — a Claude Code plugin

Dialectical planning inside Claude Code. A task goes through three roles in **isolated
contexts** — Proposer, Challenger, Resolver — instead of one agent critiquing itself.

Named after the Hindustani classical duet where two musicians push each other to perform
at a higher level.

## Install

```bash
/plugin marketplace add mavaali/jugalbandi-protocol
/plugin install jugalbandi@jugalbandi-protocol
```

Or run it straight from a clone, without installing:

```bash
claude --plugin-dir ./plugins/jugalbandi
```

### Cloud sessions

Claude Code on the web runs in a fresh container per session, so a user-scope install
doesn't survive. Put the install in your **environment's setup script** — it runs before
every session:

```bash
claude plugin marketplace add mavaali/jugalbandi-protocol
claude plugin install jugalbandi@jugalbandi-protocol
```

The repo also ships a `.claude/settings.json` declaring the marketplace and enabling the
plugin. That's what makes the plugin offer itself in interactive CLI and desktop sessions
once you trust the folder — but it is only the declarative half. A plugin enabled solely
by project settings, from an external source like a GitHub repo, doesn't load until it is
actually installed, and a headless cloud session has nobody to prompt. The setup script is
what closes that gap.

## Use

```
/jugalbandi:plan Add multi-region failover to the payments service
/jugalbandi:challenge docs/rfc-042.md
/jugalbandi:challenge          # attacks the plan already in the conversation
```

Claude will also reach for `/jugalbandi:plan` on its own when a task is ambiguous or
hard to reverse.

## What runs

```
Task → Proposer (plan + assumptions)
     → Challenger (≥3 tagged challenges, cannot approve)
     → Resolver (dispositions every challenge)
     → Final plan + open questions for you
```

| Role | Sees | Produces |
| :--- | :--- | :--- |
| **Proposer** | The task, the codebase | Plan + an explicit `## Assumptions` section |
| **Challenger** | The proposal file *only* — never the task, never the Proposer's role | ≥3 challenges tagged `[STRUCTURAL]`, `[ASSUMPTION]`, or `[MISSING]`. It has no approval verb. |
| **Resolver** | Both files, neither role's system prompt | Every challenge dispositioned **Accepted** / **Rejected** / **Escalated**, plus the revised plan |

Each role is a separate Claude Code subagent, so the isolation is real: a subagent's
context is exactly the prompt it was handed. The roles pass work through files in
`.jugalbandi/<slug>/`, which also means you can read the raw proposal and the raw
challenges afterward instead of taking the summary on faith.

Escalations are surfaced to you as actual questions via `AskUserQuestion`. That's the
point of the protocol — it finds the decisions an agent shouldn't be making alone.

## Why not just ask for a critique

Across 5 ambiguous engineering tasks (Claude Sonnet 4), measured in the harness in the
[parent repo](../../README.md):

| Metric | Single-pass self-critique | Council (3× parallel) | Jugalbandi |
| :--- | ---: | ---: | ---: |
| Assumptions surfaced (avg) | 9.4 | 14.2 | **25.4** |
| Critiques / challenges (avg) | 4.8 | 12.8 | 7.2 |

2.7× single-pass and 1.8× council on assumption surfacing, at the same compute budget as
council. That gap is the result that survived ablation testing; an earlier claim about
escalation rates did not. Full story in the
[blog post](https://www.waglesworld.com/blog/jugalbandi-protocol-what-happens-when-you-force-ai-agents-to-argue).

Those numbers come from the standalone API harness, not from this plugin. Treat them as
the reason the protocol is shaped this way, not as a benchmark of the plugin itself.

## How this differs from the benchmarked harness

The plugin adapts the protocol for a real codebase. Two deliberate changes:

1. **The roles can read the repo.** In the harness all three roles worked from text
   alone. Here the Proposer grounds its plan in real files, and the Challenger can check
   whether the proposal's claims about the codebase are actually true. The Challenger
   still receives only the proposal — repo access lets it verify claims, not import
   requirements the proposal never made.
2. **Escalations become questions.** The harness counted them. The plugin asks them.

Everything else is preserved, including the Challenger's inability to approve and the
Resolver's obligation to disposition every challenge individually.

## Cost

One `/jugalbandi:plan` is three subagent runs, each reading code. It's meaningfully more
expensive than asking for a plan. Spend it on decisions that are expensive to unwind —
schema changes, public interfaces, migrations, anything with a rollback plan — and use a
plain prompt for the rest.

## Artifacts

Runs write to `.jugalbandi/<slug>/` in your project:

```
.jugalbandi/multi-region-failover/
├── proposal.md      # Proposer, verbatim
├── challenges.md    # Challenger, verbatim
└── final-plan.md    # Resolver: dispositions + revised plan + open questions
```

Add `.jugalbandi/` to `.gitignore` if you don't want them tracked.
