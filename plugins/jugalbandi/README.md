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
/jugalbandi:plan Migrate the billing schema --rounds 2
/jugalbandi:challenge docs/rfc-042.md
/jugalbandi:challenge          # attacks the plan already in the conversation
/jugalbandi:review             # attacks the working diff, before you open a PR
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

## The second round

`--rounds 2` runs the Challenger and Resolver a second time, over the revised plan.

It exists because in a single round the revised plan is the least-reviewed artifact in
the run. Every accepted challenge produces a revision that no Challenger has ever seen,
so what you ship has had less scrutiny than the draft it replaced.

The round-2 Challenger receives the `## Revised Plan` section **only** — the
dispositions are stripped, and it is never told a first round happened. That strip is
load-bearing. A Challenger that can see the dispositions argues with the Resolver
instead of attacking the plan, and re-litigates rejections until the Resolver caves.

The exit is fixed at two rounds, deliberately. It is not convergence and not "until the
Challenger is satisfied" — the Challenger has no approval verb and can never signal
done, so an agreement-based exit would either never terminate or quietly pressure the
roles into agreeing, which is the failure the protocol exists to avoid.

Round 2 also produces a free diagnostic: the run reports how many round-2 challenges are
genuinely new versus rediscoveries of round-1 challenges the Resolver rejected. A high
rediscovery rate is a finding about the Resolver — an independent Challenger, with no
knowledge that the point was ever raised, raised it again.

Cost is the catch: five subagent runs instead of three.

## Reviewing results, not plans

`/jugalbandi:review` points the same cold read at a finished diff.

It is **not** the three-role protocol aimed at code, and the difference is worth being
precise about. On results there is no Proposer, and the Proposer is where the measured
win comes from — 25.4 assumptions is a property of a role *instructed to declare every
unstated decision while making it*, not of adversarial structure in general. You cannot
recover that after the fact; asking an implementer to retro-fit an assumptions list to a
finished diff gets you post-hoc rationalization from the party least motivated to report
honestly.

So the review skill keeps what does transfer and drops what doesn't:

- **Checks run first.** Tests, type check, lint. If they fail, the skill reports and
  stops. Plans have no ground truth, which is why an adversary is the only instrument
  available; a diff has plenty, and tooling is cheaper and more reliable for the
  checkable part. Spending a subagent to rediscover a type error is waste.
- **The reviewer reads cold** — the diff and nothing else. No commit messages, no branch
  name, no PR description. Those are the author's claim about intent, and the point is
  to judge what the code does instead.
- **A fourth tag, `[DRIFT]`.** If a `final-plan.md` exists for the work, its dispositions
  and open questions are handed over as the specification. `[DRIFT]` means the code
  contradicts a decision already made — or answers a question the plan explicitly
  escalated to a human. That last case is the sharpest finding the plugin can produce:
  a question flagged as needing human judgment, quietly answered in code.
- **No Resolver.** On a plan a bad disposition muddies a document; on a diff it would
  edit code and break something that works. That needs a test oracle strong enough to
  catch a bad acceptance, and "the tests passed before the edit" isn't it.

Drift only works as the back half of a run that started with `/jugalbandi:plan` — it
needs the decision list that run produced. Plan, build, then check whether the build
honored the plan.

One operational wrinkle worth knowing. A skill's `allowed-tools` grant has to name
commands up front, and this skill's check step runs whatever *your* project uses — which
can't be known in advance. Interactively that's fine: you get asked and approve. Headless
it isn't, because an unanswered prompt is a denial, so the checks silently don't run:

```bash
claude -p "/jugalbandi:review main...HEAD" --allowedTools "Bash"
```

The skill is required to say plainly when it couldn't run the checks rather than
hand-simulate them and report a result as if they ran.

These are design arguments, not measured results. The numbers below cover planning only;
a results variant would need its own baseline against "just ask for a code review" and
"run the tests" before it earns a row in that table.

## Composing with `/goal`

[`/goal`](https://code.claude.com/docs/en/goal) sets a completion condition and keeps
Claude working across turns, with a separate small model judging after each turn whether
the condition holds. It rests on the same idea this plugin does — *the one doing the work
doesn't get to call the finish line* — applied to termination instead of content. They
compose well. One conflict will bite if you don't design for it.

### Never make a Jugalbandi review the finish line

The Challenger and Reviewer have no approval verb. A condition like "until
`/jugalbandi:review` is satisfied" never terminates, for the same reason the second round
is capped at two rather than run to convergence.

Anchor the condition on **dispositions** instead — something Claude can finish:

```
/goal Every [STRUCTURAL] and [DRIFT] finding from the /jugalbandi:review I ran has been
fixed or explicitly declined with a stated reason, and npm test exits 0. Stop after 15 turns.
```

The reviewer supplies findings; the goal evaluator judges whether they were dealt with.
Two judges, different jobs, neither doing the other's.

### Make "blocked on a human" a success state

When the protocol escalates, it has found a decision a human must make. Under a goal
there is no human — and the evaluator doesn't wait. A "no" verdict returns a reason that
becomes guidance for the next turn, which is structurally pressure to push past the
escalation.

**How much that pressure actually bites is not established.** A two-arm test — identical
fixture, one condition with the escape hatch below and one without — did not reproduce
any suppression. The naive arm escalated nothing, but not by caving: it produced a design
that injected the unknowable values as parameters rather than guessing them, which is the
right answer. Neither arm invented a value it had been told not to invent. That is one run
per arm, with different proposals and different challenge sets, so it is not a controlled
comparison either way — it is grounds for not overclaiming, not grounds for reassurance.

Write the condition to accommodate blocking anyway. It costs one clause, and it is the
difference between a goal that can express "waiting on a human" and one that structurally
cannot:

```
/goal Either (a) I have stated the plan has zero open escalations and npm test exits 0,
or (b) I have listed the open escalations verbatim in my reply and stopped — (b) counts
as complete, not as failure. Stop after 15 turns.
```

Phrase it as *what Claude said*, never as *what is on disk*. The evaluator doesn't call
tools; it only reads the conversation. `OPEN-QUESTIONS.md exists` is unjudgeable, while
"I have listed the open escalations verbatim" is right there in the transcript. This is
also why both skills are required to report findings and escalations inline rather than
pointing at artifact paths.

### Two practical constraints

**Cost.** One `/jugalbandi:plan` is three to five subagent runs. A goal re-runs turns
until its condition holds, so a condition implying the protocol re-runs each turn gets
expensive fast. Treat a review as a one-time gate — "run it once, then address the
findings" — never as the loop body.

**Permissions.** A goal doesn't grant any. `/jugalbandi:review` runs *your* project's
check commands, which can't be pre-declared in a skill's `allowed-tools`, so unattended
goal turns need [auto mode](https://code.claude.com/docs/en/auto-mode-config) alongside.

### The shape worth using

```
/jugalbandi:plan <task>     # escalations answered here, where a human is present
                            # …then a goal anchored on those decisions
/jugalbandi:review          # exit gate: does the build honor what was agreed?
```

Plan with a human in the loop, build without one, verify against what was decided. The
escalations get answered at the one point where somebody is actually there to answer them.

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
├── proposal.md          # Proposer, verbatim
├── challenges.md        # Challenger, verbatim
├── final-plan.md        # Resolver: dispositions + revised plan + open questions
└── round-2/             # only with --rounds 2
    ├── proposal.md      # the revised plan, dispositions stripped
    ├── challenges.md
    └── final-plan.md
```

Add `.jugalbandi/` to `.gitignore` if you don't want them tracked.

## Development

Local iteration, without installing:

```bash
claude --plugin-dir ./plugins/jugalbandi
```

Run `/reload-plugins` after editing a `SKILL.md` or an agent prompt.

### Checks

Two layers, split by what they cost:

```bash
claude plugin validate ./plugins/jugalbandi --strict   # manifests and frontmatter
claude plugin validate . --strict                      # the marketplace entry
node scripts/check-plugin.mjs                          # cross-references
```

All three are free, need no authentication, and run on every pull request via
`.github/workflows/plugin.yml`.

`claude plugin validate` is the authority on manifest and frontmatter shape — it parses
frontmatter the way Claude Code actually does, which is stricter than it looks. An
`argument-hint` of `[task] [--rounds 1|2]` is not valid YAML, and a skill whose
frontmatter fails to parse loads with *every field silently dropped*. Trust the
validator over any hand-rolled parser, including the one in `check-plugin.mjs`.

`check-plugin.mjs` covers the two things the validator has no opinion about: version
drift between `plugin.json` and the marketplace entry (both declare a version, and
`plugin.json` wins at load time), and a skill telling the model to launch an agent the
plugin doesn't ship — which otherwise surfaces only when the skill runs and stalls.

The behavioral test is separate because it costs a live five-subagent run and takes
several minutes:

```bash
scripts/smoke-plugin.sh
```

It runs the real two-round protocol against a throwaway fixture and asserts the
protocol's invariants on the artifacts: the proposal has an `## Assumptions` section,
the Challenger produced at least three tagged challenges, the Resolver dispositioned
every one of them, and the round-2 proposal carries no dispositions. Run it before a
release and after touching any prompt.

### Releasing

Bump `version` in **both** `plugin.json` and the marketplace entry — `check-plugin.mjs`
fails the build if they disagree — then:

```bash
claude plugin tag ./plugins/jugalbandi --push
```

That validates the two manifests agree before creating the `jugalbandi--v<version>` tag.

Claude Code also ships an eval harness (`claude plugin eval`, with a with/without
ablation arm that mirrors this repo's own methodology). It's gated to early access, so
`scripts/smoke-plugin.sh` stands in for it until that opens up.
