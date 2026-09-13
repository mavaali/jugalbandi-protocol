# The assumption-surfacing gap measures a prompt, not the protocol

**Date:** 2026-09-12
**Status:** Confound identified; corrected re-run in progress
**Affects:** The README's headline result, and H1/H3 in `commitment/hypotheses.md`

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

## The corrected experiment

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

## Limitations of the re-run

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
