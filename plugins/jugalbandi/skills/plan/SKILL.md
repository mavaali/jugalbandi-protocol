---
name: plan
description: Run the Jugalbandi dialectical protocol on a task — Proposer, Challenger, and Resolver in isolated subagent contexts — to surface hidden assumptions before any code is written. Use for ambiguous, high-stakes, or hard-to-reverse work where the real risk is building the wrong thing, not building it badly.
argument-hint: "[task description] [--rounds 1|2]"
allowed-tools: Bash(mkdir -p *), Bash(date *)
---

# Jugalbandi: dialectical planning

Run the task below through three roles in isolated contexts. The isolation is the
mechanism — it is what separates this from asking one agent to critique itself.

**Task:** $ARGUMENTS

If the task above is empty, use the work currently under discussion in this
conversation, and state in one line which task you inferred before proceeding.

If the task text contains `--rounds 2`, strip that flag from the task before passing it
to the Proposer and run the second round in step 7. Anything else, including
`--rounds 1` or no flag at all, is a single round. Never run more than two rounds.

## The isolation rules

These are not stylistic. Breaking any of them collapses the protocol into
self-critique, which is the baseline this is measured against.

- The Challenger receives the Proposer's output **and nothing else**. Not the task
  text, not the Proposer's role description, not anything you learned while the
  Proposer was running, not your own opinion of the plan.
- Never paraphrase, summarize, excerpt, or "clean up" one role's output on the way to
  the next. Hand off through files only.
- Do not add your own analysis to any role's prompt. You are the conductor, not a
  fourth voice.
- Run the roles strictly in order. Each one depends on the previous artifact existing.

## Steps

1. **Set up the run directory.** Pick a short kebab-case slug for the task. If
   `.jugalbandi/<slug>/` already exists, append `-2`, `-3`, and so
   on — a second run of a similar task must not overwrite the first one's artifacts,
   which are the audit trail. Then:

   ```
   mkdir -p ".jugalbandi/<slug>"
   ```

   The path is relative to the project root, deliberately — do not interpolate
   `$CLAUDE_PROJECT_DIR`, which is unset in headless `-p` runs and expands to an
   absolute path at the filesystem root.

   These paths are a contract, not a suggestion. `/jugalbandi:review` finds the decision
   list for its `[DRIFT]` checks by globbing `.jugalbandi/*/final-plan.md` and
   `.jugalbandi/*/round-2/final-plan.md`. A run that writes `plan_final.md` or
   `resolution.md` in the project root instead is invisible to it, and drift detection
   then reports nothing wrong rather than reporting that it couldn't look. Keep the
   `.jugalbandi/<slug>/` shape and the three filenames — `proposal.md`,
   `challenges.md`, `final-plan.md` — exactly.

   Call that directory `RUN` below. If `.jugalbandi/` is not in the project's
   `.gitignore`, mention that at the end — don't edit `.gitignore` yourself.

2. **Proposer.** Launch the `jugalbandi:proposer` subagent. Its prompt is the task
   text plus this line:

   > Write your full plan to `RUN/proposal.md`.

   Nothing else goes in that prompt.

3. **Challenger.** Launch the `jugalbandi:challenger` subagent. Its prompt is exactly:

   > Read `RUN/proposal.md`. That file is the entire proposal under review — it is all
   > the context you get. Write your challenges to `RUN/challenges.md`.

   Do not add the task. Do not add context. This prompt is the whole prompt.

4. **Resolver.** Launch the `jugalbandi:resolver` subagent. Its prompt is exactly:

   > The proposal is at `RUN/proposal.md`. The challenges against it are at
   > `RUN/challenges.md`. Disposition every challenge and write the final plan to
   > `RUN/final-plan.md`.

5. **Second round, only if `--rounds 2` was passed.** See "The second round" below.
   Otherwise skip to step 6.

6. **Report.** Read the final plan — `RUN/round-2/final-plan.md` if a second round ran,
   `RUN/final-plan.md` otherwise. Present to the user, in this order:

   - The revised plan.
   - A one-line tally per round: `N challenges (S structural / A assumption / M
     missing) → X accepted, Y rejected, Z escalated`.
   - The two or three accepted challenges that changed the plan most, one line each —
     this is the part worth the compute, so make it legible.
   - After a second round, the novelty line from step 7.4.
   - The artifact paths, so the user can read the raw proposal and challenges.

   **Put all of this in your reply, not only in the files.** A path is not a report.
   Anything judging this run from outside — a human skimming, a `/goal` evaluator, a
   Stop hook — sees the conversation, not the filesystem. An outcome that exists only in
   `final-plan.md` is invisible to every one of them, and a run whose escalations were
   never spoken aloud reads exactly like a run that had none.

7. **Escalations are the deliverable.** Collect the open questions from **every** round,
   not just the last one, and put them to the user with `AskUserQuestion`. They are
   precisely the decisions the protocol found that a human, not an agent, has to make.
   Once answered, fold the answers into the plan and update the final plan file.

   After a second round this means the union of `RUN/final-plan.md` and
   `RUN/round-2/final-plan.md` — deduplicated where both raise the same question. A
   round-1 escalation does not travel into round 2: the round-2 Challenger sees only the
   revised plan, so an open question round 2 happens not to rediscover would otherwise
   vanish. Losing an escalation is the one failure this protocol cannot tolerate, and
   the extra round must not cause it.

   **If nobody is there to ask** — a headless `-p` run, a scheduled task, an autonomous
   loop, an active `/goal` — do not call `AskUserQuestion`, and do not answer the
   questions yourself. Write them to `RUN/OPEN-QUESTIONS.md`, **list them verbatim in
   your reply**, and stop. An escalation answered by the agent that raised it is not an
   escalation; it is the unsanctioned decision this protocol exists to surface. A prompt
   into an empty room is worse still, because it looks like the question was asked.

   Expect to be pushed past this. Under `/goal`, an evaluator that judges the run
   incomplete returns a reason that becomes guidance for the next turn — which is,
   precisely, pressure to resolve what you just escalated. Do not take it. Restate the
   open questions and stop again. Being blocked on a human decision is a finished state
   for this protocol, not a failed one, and a goal condition that cannot express that is
   the wrong condition. See "Composing with /goal" in the README.

## The second round

The revised plan is the least-reviewed artifact in a single-round run. Every accepted
challenge produces a revision that no Challenger has ever seen, so the thing you ship
has had less scrutiny than the draft you threw away. A second round fixes that.

The exit is fixed at two rounds. It is **not** convergence, agreement, or "until the
Challenger is satisfied" — the Challenger has no approval verb and can never signal
done, so any agreement-based exit would either never terminate or quietly pressure the
roles into agreeing. Two rounds, then stop.

Run these after step 4:

1. **Extract the revised plan, verbatim.** Copy the `## Revised Plan` section of
   `RUN/final-plan.md` — that section only — into `RUN/round-2/proposal.md`. Copy the
   text exactly. Do not include the dispositions, the open questions, the round-1
   challenges, or a note that this is a second round.

   This strip is the whole point. A Challenger that can see the dispositions argues
   with the Resolver instead of attacking the plan, and re-litigates rejections until
   the Resolver caves. A Challenger handed the revised plan cold does not know a first
   round happened and attacks what is in front of it.

2. **Challenger, again.** Same prompt shape as step 3, against the round-2 paths:

   > Read `RUN/round-2/proposal.md`. That file is the entire proposal under review — it
   > is all the context you get. Write your challenges to `RUN/round-2/challenges.md`.

3. **Resolver, again.** Same prompt shape as step 4, against the round-2 paths. The
   round-2 Resolver sees the round-2 proposal and challenges only — not round 1's
   dispositions.

4. **Measure novelty.** You have both challenge files. Compare them and report one
   line: how many round-2 challenges are genuinely new, and how many are rediscoveries
   of round-1 challenges the Resolver rejected.

   A high rediscovery rate is a finding about the Resolver, not noise: an independent
   Challenger, with no knowledge that the point was ever raised, raised it again. Say
   so plainly when it happens — it means those rejections deserve a second look.

## After the run

Before you report, confirm the artifacts are where they belong: `RUN/proposal.md`,
`RUN/challenges.md`, `RUN/final-plan.md`, plus the `round-2/` trio after a second round.
If any of them ended up elsewhere or under a different name, move them into place. This
takes a moment and keeps the run legible to `/jugalbandi:review` and to whoever reads it
next.

Stop at the plan. Do not start implementing unless the user asks. If they do, work from
the final plan — the revised plan, not the original proposal.
