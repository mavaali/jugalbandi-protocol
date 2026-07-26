---
name: plan
description: Run the Jugalbandi dialectical protocol on a task — Proposer, Challenger, and Resolver in isolated subagent contexts — to surface hidden assumptions before any code is written. Use for ambiguous, high-stakes, or hard-to-reverse work where the real risk is building the wrong thing, not building it badly.
argument-hint: [task description]
allowed-tools: Bash(mkdir -p *), Bash(date *)
---

# Jugalbandi: dialectical planning

Run the task below through three roles in isolated contexts. The isolation is the
mechanism — it is what separates this from asking one agent to critique itself.

**Task:** $ARGUMENTS

If the task above is empty, use the work currently under discussion in this
conversation, and state in one line which task you inferred before proceeding.

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

1. **Set up the run directory.** Pick a short kebab-case slug for the task. Then:

   ```
   mkdir -p "${CLAUDE_PROJECT_DIR}/.jugalbandi/<slug>"
   ```

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

5. **Report.** Read `RUN/final-plan.md`. Present to the user, in this order:

   - The revised plan.
   - A one-line tally: `N challenges (S structural / A assumption / M missing) →
     X accepted, Y rejected, Z escalated`.
   - The two or three accepted challenges that changed the plan most, one line each —
     this is the part worth the compute, so make it legible.
   - The artifact paths, so the user can read the raw proposal and challenges.

6. **Escalations are the deliverable.** If the Resolver escalated anything, put those
   open questions to the user with `AskUserQuestion` — they are precisely the decisions
   the protocol found that a human, not an agent, has to make. Once answered, fold the
   answers into the plan and update `RUN/final-plan.md`.

## After the run

Stop at the plan. Do not start implementing unless the user asks. If they do, work from
`RUN/final-plan.md` — the revised plan, not the original proposal.
