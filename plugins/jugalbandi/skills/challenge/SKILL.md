---
name: challenge
description: Run only the Jugalbandi Challenger against a plan that already exists — a design doc, an RFC, a proposal file, or a plan sitting in this conversation. Returns at least three tagged adversarial challenges and never an approval. Use when you want the attack without re-planning from scratch.
argument-hint: "[path to plan file, or blank to use the plan in this conversation]"
allowed-tools: Bash(mkdir -p *)
---

# Jugalbandi: challenge an existing plan

Run one round of adversarial review against a plan that already exists.

**Target:** $ARGUMENTS

## Steps

1. **Resolve the target.**

   - If the argument is a file path, that file is the proposal. Use it directly.
   - If the argument is empty, the target is the most recent plan, design, or proposal
     in this conversation. Copy it **verbatim** into
     `.jugalbandi/adhoc/proposal.md` (create the directory first).
     Copy, do not summarize — a summarized proposal produces summarized challenges.
     Then say in one line which plan you took as the target.

2. **Launch the `jugalbandi:challenger` subagent.** Its prompt is exactly:

   > Read `<path>`. That file is the entire proposal under review — it is all the
   > context you get. Write your challenges to `<dir>/challenges.md`.

   Add nothing else. No task description, no background, no framing, no hint about
   which parts you think are weak. The Challenger's value comes from not having your
   context; supplying it is the one way to waste this call.

3. **Report.** Present each challenge grouped by tag — `[STRUCTURAL]`, `[ASSUMPTION]`,
   `[MISSING]` — with a one-line tally, and give the path to `challenges.md`.

4. **Do not resolve them.** Surfacing is the whole job here. If the user wants
   dispositions and a revised plan, run `/jugalbandi:plan` for the full three-role
   protocol, or ask them which challenges to act on.
