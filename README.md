# Jugalbandi Protocol

A dialectical protocol for agent task execution. Three roles, one model, isolated contexts — testing whether structured adversarial challenge produces measurably different outputs than single-pass self-critique.

Named after the Hindustani classical music duet where two musicians push each other to perform at a higher level.

## The Protocol

```
Task → Proposer (plan + assumptions) → Challenger (min 3 tagged challenges) → Resolver (dispositions) → Output
```

- **Proposer**: Produces an implementation plan and declares every unstated assumption
- **Challenger**: Adversarial reviewer. Cannot approve. Tags challenges as `[STRUCTURAL]`, `[ASSUMPTION]`, or `[MISSING]`
- **Resolver**: Dispositions every challenge as accepted (with revision), rejected (with justification), or escalated (needs human input)

Context isolation is the mechanism — the Challenger never sees the Proposer's system prompt, the Resolver sees both outputs but neither system prompt.

## Comparison

Every task runs through three paths:

1. **Single-pass**: One call — plan, assumptions, self-critique, revise
2. **Council**: Three independent single-pass calls in parallel (same compute budget as Jugalbandi)
3. **Jugalbandi**: The three-role loop above

## Results

> **Correction (2026-09-12).** The originally published 2.7x assumption-surfacing gap was
> substantially a measurement artifact. Re-scored honestly, the gap is **1.34x** at the
> Proposer and **1.07x — not statistically significant** at the Resolver, which is the
> output this protocol actually delivers. The original numbers are kept below, struck
> through, because deleting them would hide what was claimed. Full analysis:
> [docs/findings/2026-09-12-assumption-metric-confound.md](docs/findings/2026-09-12-assumption-metric-confound.md).

### What was published

| Metric | Single-Pass | Council (3x) | Jugalbandi |
|--------|------------|--------------|------------|
| ~~Assumptions surfaced (avg)~~ | ~~9.4~~ | ~~14.2~~ | ~~25.4~~ |
| ~~Critiques/challenges (avg)~~ | ~~4.8~~ | ~~12.8~~ | ~~7.2~~ |

### What went wrong

Both rows were counted with regexes keyed to markdown headings and bullet formats — and
**only the Jugalbandi prompts instruct the model to produce those formats.** `PROPOSER_PROMPT`
demands an `## Assumptions` section, which is exactly the heading `countAssumptions` greps
for. `CHALLENGER_PROMPT` mandates the literal tags `[STRUCTURAL]` / `[ASSUMPTION]` /
`[MISSING]`, which is exactly what `countChallengeTags` counts. The single-pass baseline was
told none of this and was scored by guessing at formats it never agreed to use.

Measured against a blind semantic judge, the regex found **37%** of the baseline's real
assumptions and **80%** of the Proposer's. That asymmetry is most of the published gap.

A second, independent flaw: the assumptions metric was computed on the **Proposer's** output
(`src/protocol.ts:69`), which is produced before the Challenger or Resolver run. The headline
number never measured the protocol — it compared two single calls.

### Corrected results

Same five tasks, same original model outputs, re-scored by a blind judge that ignores
formatting and counts assumptions by substance. Ten repeats per text, 150 calls.

| Arm | Assumptions (judge, n=10) | vs single-pass |
|---|---|---|
| Single-pass | 25.4 | — |
| Jugalbandi — Proposer draft | 34.1 | **1.34x** (detectable on all 5 tasks) |
| Jugalbandi — Resolver output | 27.2 | **1.07x** (paired t=0.68, **not significant**) |

- **The Proposer does surface more assumptions than a single pass.** But both are single
  model calls, so this is a result about prompt wording — `PROPOSER_PROMPT` versus
  `BASELINE_PROMPT` — not about the three-role architecture.
- **The protocol's final output shows no reliable advantage.** Three tasks better, one
  indistinguishable, one significantly worse (`multitenant`: 18.4 vs the baseline's 26.2).
  The Proposer enumerates more; the Challenger and Resolver then consolidate it away.
- **Council was not re-scored**, so no corrected figure is offered for it.
- **The critiques row is withdrawn without replacement.** `countCritiques` scored a baseline
  section containing five explicit, numbered flaws as **0**, because they were bold
  paragraphs rather than headings or list items. No honest number has been produced yet.

### What this does not show

This is not evidence that the protocol is useless. It is evidence that *this metric*, on
*these five tasks*, does not support the claim that was made. Assumption count is a proxy —
and a crude one — for whether a plan is better. The escalation behaviour, the audit trail,
and the value of being handed explicit open questions are untouched by this analysis, and
were never what the 2.7x measured.

Caveats on the correction itself: a noisy instrument replaced a biased one (the judge cannot
be pinned deterministically), the across-task test is n=5, and each original text is a single
generation whose variance was never measured. Details in the findings doc.

## Usage

```bash
cp .env.example .env  # add your ANTHROPIC_API_KEY
npm install
npx tsx src/runner.ts --task 1  # run one task (1-5)
npx tsx src/runner.ts           # run all 5 tasks
```

Results are written to `results/task-N-slug.json`.

## Claude Code Plugin

The protocol also ships as a Claude Code plugin, so you can run it against a real codebase instead of a benchmark task:

```bash
/plugin marketplace add mavaali/jugalbandi-protocol
/plugin install jugalbandi@jugalbandi-protocol

/jugalbandi:plan Add multi-region failover to the payments service
/jugalbandi:challenge docs/rfc-042.md
```

Each role is a separate subagent, so half the isolation is structural: the harness guarantees a subagent starts with no context beyond the prompt it is handed, and no amount of sloppy prompting can leak the Proposer's reasoning into the Challenger's head. The other half — not pasting the task text into that prompt in the first place — is still discipline, enforced by rules in the skill rather than by the runtime. Escalations come back as questions you actually get asked. See [`plugins/jugalbandi/`](plugins/jugalbandi/README.md).

## Blog Post

[Jugalbandi Protocol: What Happens When You Force AI Agents to Argue](https://www.waglesworld.com/blog/jugalbandi-protocol-what-happens-when-you-force-ai-agents-to-argue)

⚠️ The post reports the original 2.7x figure, which the correction above supersedes. It has
not been updated.
