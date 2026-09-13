# The assumption-surfacing gap measures a prompt, not the protocol

**Date:** 2026-09-12
**Status:** Complete. Confound confirmed and quantified against the original data.
**Affects:** The README's headline result, and H1/H3 in `commitment/hypotheses.md`

> **Result in one line:** re-scored with a blind semantic judge, the published 2.7x
> assumption gap is **1.34x** at the Proposer, and **1.07x — not statistically
> significant** at the Resolver, which is the output the protocol actually delivers.

## The claim under examination

> | Metric | Single-Pass | Council (3x) | Jugalbandi |
> | Assumptions surfaced (avg) | 9.4 | 14.2 | 25.4 |
>
> The assumption surfacing gap (2.7x single-pass, 1.8x council) is the result that
> survived ablation testing.
>
> — `README.md`

## Finding 1: the metric is computed on one call, before the protocol runs

`proposer_assumptions` is computed at `src/protocol.ts:69` as
`countAssumptions(proposerOutput)`. The Proposer runs first; the Challenger and Resolver
execute afterwards and their outputs are never fed into this number.

So the comparison labelled "Single-Pass vs Jugalbandi" is, for this metric,
`BASELINE_PROMPT` versus `PROPOSER_PROMPT` — one model call each. The dialectical
structure that gives the protocol its name contributes nothing to the figure.

This is not a subtle instrumentation detail. It means the headline result cannot be
evidence about a three-role protocol, because two of the three roles are not measured.

## Finding 2: the two prompts are not matched on the thing being measured

The metric counts bullets under a heading matching `/^##[^#\n]*assumption/im`.

**`PROPOSER_PROMPT`** devotes a dedicated paragraph to producing exactly that:

> An explicit `"## Assumptions"` section listing EVERY unstated decision you made […]
> For the Assumptions section, be thorough. Every time you chose a technology, pattern,
> scope boundary, or default behavior without the task explicitly requiring it — that's
> an assumption. List it.

It supplies emphasis, a taxonomy of what qualifies, and the exact heading string the
counter greps for.

**`BASELINE_PROMPT`** gives the same task nine words, as item 2 of a four-item list:

> 2. List your assumptions — every unstated decision you made

No emphasis, no taxonomy, no heading specified.

A difference in output under these two instructions is a measurement of the
instructions, not of the architecture around them.

## Finding 3 (hypothesis refuted): this is not a token-budget artifact

An earlier version of this analysis proposed that the baseline was squeezed because both
arms get `max_tokens: 4096` while the baseline must fit four jobs into it. **The data
does not support that.**

| Task | Baseline chars | Proposer chars | Baseline assumptions | Proposer assumptions |
|---|---|---|---|---|
| 1 login | 4,583 | 4,822 | 10 | 39 |
| 2 cicd | 5,115 | 13,347 | 10 | 30 |
| 3 multitenant | 6,425 | 7,909 | 9 | 26 |
| 4 notifications | 5,099 | 6,553 | 9 | 27 |
| 5 migration | 5,597 | 7,685 | 9 | 15 |

4096 tokens is roughly 16,000 characters. Every baseline output lands between 4.5k and
6.5k and ends with a complete closing sentence — none is truncated. The baseline uses
about a third of its budget and stops because it considers itself finished.

Task 1 is the cleanest case: near-identical output lengths (4,583 vs 4,822 chars) and a
3.9x difference in assumptions counted. With length effectively controlled, what remains
is the elicitation.

The refutation matters. A budget confound would have been fixable by raising a number. An
elicitation confound is a claim about what the experiment was actually comparing.

## Finding 4: the same flaw appears in the second metric row, worse

The README's other row is "Critiques/challenges (avg) | 4.8 | 12.8 | 7.2".

`countCritiques` (`src/baseline.ts:26`) locates a self-critique heading, then counts either
`^### ` subsections or list items matching `^[-*]\s` / `^\d+\.\s`. In the re-run's task 1,
the original-prompt baseline produced a `## 3. Self-Critique` section containing five
explicit flaws formatted as bold paragraphs:

```
**Flaw 1: Massive stack assumption with zero evidence.**
**Flaw 2: Security decisions made silently that have real consequences.**
...
**Flaw 5: Compliance/organizational context ignored.**
```

`countCritiques` scored that section **0**. The critiques are present, substantive, and
correctly numbered; they simply use a format the counter does not recognise.

The Jugalbandi side of the same row is counted by `countChallengeTags`, which greps for the
literal strings `[STRUCTURAL]`, `[ASSUMPTION]`, `[MISSING]` — strings `CHALLENGER_PROMPT`
**requires the model to emit**:

> Each challenge MUST be tagged with exactly one of: `[STRUCTURAL]` … `[ASSUMPTION]` …
> `[MISSING]`

So this is not two unrelated bugs. It is one pattern, in both rows of the results table:

> **The instrumentation counts strings that only the treatment arm's prompt instructs the
> model to produce.** The control arm is scored by guessing at formats it was never told
> to use, and is silently undercounted whenever it guesses differently.

For the assumptions row the effect is partial — both arms tend to produce *some* heading
matching `/assumption/i`, so the control still scores 9–12 rather than 0. For the critiques
row the effect can be total, as task 1 demonstrates: a real 5 recorded as 0.

This makes the critiques row unusable as published, and it is the row that would have to
carry any claim about the protocol producing *more scrutiny* rather than more enumeration.

## What is *not* a confound

The baseline's four-job structure — plan, assumptions, self-critique, revision — is not
unfair. That *is* the treatment being compared against: single-pass with self-critique.
Asking it to do four things is the condition, not a handicap.

The unfairness is narrower and therefore sharper: within that structure, the assumptions
step alone is elicited far less forcefully than its counterpart. Correcting it means
giving the baseline the identical assumptions paragraph while leaving its four-job shape
untouched.

## The signature in the data

Baseline assumption counts across five tasks of varying complexity: **10, 10, 9, 9, 9**.
Proposer counts on the same tasks: **39, 30, 26, 27, 15**.

The baseline is nearly flat; the Proposer tracks the task. A flat response across varying
inputs is what a weak, unspecific instruction produces — the model lists a handful and
moves on. The Proposer's variance is what unconstrained enumeration looks like when the
instruction insists on completeness.

## Consequences

**For the README.** The 2.7x figure is not wrong as arithmetic, but its label is wrong.
It compares two prompts, not two architectures. "Survived ablation testing" does not hold
for the ablation that matters most here — matching the elicitation — because that
ablation was never run.

**For H1** ("the gap will hold across tiers, smaller in the low-ambiguity tier"): H1 is
about the size of the gap under varying ambiguity. If the gap is substantially an
elicitation artifact, H1 is measuring how much room a strongly-worded prompt has to fill,
which is a real phenomenon but not the one stated.

**For H3** ("the gap will persist across instruction-following models"): this is the one
the plugin work was meant to test. As instrumented, running it across model families
would measure whether an emphatic prompt elicits more bullets in GPT and Gemini as it
does in Claude — prompt portability, not protocol generality. That is a publishable
finding, but it is not H3, and the README's claim would not follow from it.

**For H2** (`commitment/hypotheses.md` already concedes prompt sensitivity cannot be
ruled out for the *escalation* claim): the same concern applies to the headline
assumption claim, and with more force, since the escalation claim at least involves the
Resolver.

## Appendix: the corrected experiment as designed

Three arms, same five tasks, same pinned model (`claude-sonnet-4-20250514`):

1. **`single_pass`** — the original `BASELINE_PROMPT`, unchanged. Reproduces the
   published number and confirms the harness still behaves as it did.
2. **`single_pass_matched`** — identical to the baseline in every respect except that the
   assumptions step carries the Proposer's exact wording, emphasis, taxonomy, and heading
   specification. The four-job structure is preserved.
3. **`jugalbandi`** — unchanged.

The question this answers: **how much of the 2.7x survives when the only difference
remaining is the architecture?**

- If arm 2 rises to meet the Proposer, the gap was elicitation.
- If arm 2 stays near 9–10, the gap is structural and the original claim survives with a
  much stronger foundation than it currently has.
- Anything in between is the interesting case, and is quantifiable.

## Results

Every arm's raw output from the original five tasks, re-scored by the blind judge
(`src/judge.ts`), ten repeats per text, 150 judge calls, $2.60 measured
(389,513 input / 182,442 output tokens). Raw data: `results/rescored/assumptions.json`.

### The regex undercounts the two arms by very different amounts

| | regex mean | judge mean | regex captured |
|---|---|---|---|
| single_pass | 9.4 | 25.4 | **37%** |
| proposer | 27.4 | 34.1 | **80%** |

This is the confound, measured. The control arm's assumptions are scattered through its
prose, so a heading-keyed counter finds barely a third of them. The Proposer is instructed
to write `## Assumptions`, so its assumptions sit exactly where the counter looks and four
in five are found. **The published gap is largely the difference between those two capture
rates, not a difference in the plans.**

(Note: the regex `single_pass` mean of 9.4 reproduces the README's figure exactly. The
regex `proposer` mean computes to 27.4 from the same files, where the README reports 25.4 —
a small discrepancy in the published table, separate from everything else here.)

### Per-task judge means (n=10 each, SD in parentheses)

| task | single_pass | proposer | resolver | P − S | t |
|---|---|---|---|---|---|
| login | 29.5 (2.9) | 47.3 (2.8) | 34.1 (3.8) | +17.8 | 14.1 |
| cicd | 27.0 (2.4) | 35.1 (2.2) | 33.7 (6.0) | +8.1 | 7.8 |
| multitenant | 26.2 (3.2) | 28.7 (0.9) | 18.4 (1.7) | +2.5 | 2.4 |
| notifications | 25.2 (2.0) | 32.9 (4.5) | 25.1 (3.0) | +7.7 | 5.0 |
| migration | 18.9 (2.2) | 26.4 (2.0) | 24.6 (1.6) | +7.5 | 7.9 |
| **pooled** | **25.4** | **34.1** | **27.2** | | |

An earlier version of this analysis proposed rejecting any difference smaller than the
judge's observed *range*. That heuristic was too crude: at n=10 the standard error is far
below the range, and a Welch test is the right instrument. By that test the Proposer
advantage is detectable on all five tasks — it is real, just far smaller than advertised.

**Proposer vs single-pass: 1.34x** (published: 2.7x).

### The protocol's actual deliverable shows no reliable advantage

The Resolver's output is what a user receives. The original instrument never measured it.

| task | resolver − single_pass | t | |
|---|---|---|---|
| login | +4.6 | 3.0 | better |
| cicd | +6.7 | 3.3 | better |
| multitenant | **−7.8** | −6.9 | **worse** |
| notifications | −0.1 | −0.1 | no difference |
| migration | +5.7 | 6.5 | better |

Mean difference +1.8 (SD 6.0). Paired across the five tasks, **t = 0.68 against a
threshold of 2.78 — not significant.**

**Resolver vs single-pass: 1.07x, and the direction is inconsistent.** Three tasks better,
one indistinguishable, one significantly worse. On `multitenant` the full three-role
protocol delivered a plan with meaningfully *fewer* surfaced assumptions than a single pass.

This is the finding that matters most, and it is the one the original instrument was
structurally incapable of producing: it measured a mid-pipeline draft and stopped there.
The Proposer does enumerate more than a single pass. The Challenger and Resolver then
consolidate, resolve, and discard — and what comes out the far end is, on this evidence,
about the same as what one call produces.

### What survives

- **The Proposer surfaces more assumptions than a single pass.** Real, detectable on all
  five tasks, ~1.34x. Since both are single calls, this is a finding about
  `PROPOSER_PROMPT` versus `BASELINE_PROMPT` — a prompting result, not an architectural one.
- **The three-role protocol's final output does not reliably beat a single pass** on this
  metric, on these five tasks.
- **The published 2.7x figure does not survive.** Roughly half of it was the instrument
  crediting the treatment arm for formatting it was told to produce.

## Limitations

**A noisy instrument replaced a biased one.** The judge's SD runs 0.9–6.0 per cell, and it
cannot be pinned deterministically (`temperature` is deprecated on the current model). Ten
repeats bring the standard error down enough for the tests above, but the judge is not
exact, and a different judge prompt would likely produce different absolute counts. What
should be trusted here is the *ratio between arms under one identical judge*, not the
absolute numbers.

**Five tasks.** The per-task tests are well-powered; the across-task test is n=5, which is
why the Resolver result is reported as "not significant" rather than "no effect". A larger
task set could resolve it either way.

**The judge model is not the generating model.** The texts came from
`claude-sonnet-4-20250514`; the judge is `claude-sonnet-5`. This is fine for a *comparison*
— every arm is scored by the same judge — but the absolute counts carry that judge's
notion of what counts as an assumption.

**Single generation per arm.** Each original text is one sample. Generation variance was
never measured in this project and is not measured here; only judging variance is. Two
Proposer runs on the same task might differ by more than the gap being reported.

## Notes on the aborted fresh re-run

**The original model is gone.** `claude-sonnet-4-20250514` now returns `not_found_error`.
Discovered by smoke-testing one task before committing to all five. The consequence is
specific and important:

- The re-run **cannot reproduce** the README's 9.4 / 14.2 / 25.4 figures, and its absolute
  numbers are not comparable to them. Any table combining the two would be comparing
  across an uncontrolled model change.
- The re-run **can still answer the question**, because the ablation is a *within-run*
  comparison. All three arms share one model, so the difference between
  `single_pass`, `single_pass_matched`, and `jugalbandi` is internally valid whatever
  model produces them.

The model constant now lives in `src/model.ts` with a `JUGALBANDI_MODEL` override, rather
than being pinned separately in three files that must move together.

A side effect worth noting: because the original claim was measured on a model that no
longer exists, *no* future run can reproduce it. The published number is now unfalsifiable
in its original form. That is an argument for reporting the within-run ratio as the
durable result rather than the absolute counts.

**N=1 per arm per task**, matching the original methodology. Within-task variance has
never been measured in this project, and the Proposer's across-task spread (15–39)
suggests it may not be small. A single run cannot distinguish a real effect from sampling
noise. Any difference smaller than that unmeasured variance should not be reported as a
result.

Task wording is unchanged. The original results are preserved in `results/v1-original/`
so the re-run cannot overwrite the data the published claim rests on.
