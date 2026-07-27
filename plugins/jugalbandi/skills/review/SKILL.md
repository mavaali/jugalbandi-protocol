---
name: review
description: Adversarially review finished work rather than a plan. Runs the project's own checks first, then hands a cold reviewer the diff — no commit messages, no intent, no conversation — and reports tagged findings. When a Jugalbandi plan exists for the work, also checks the diff for drift against the decisions that plan already made. Use before opening a pull request or after implementing a plan.
argument-hint: "[git ref, path, or blank for the working diff]"
allowed-tools: Bash(git diff *), Bash(git status *), Bash(mkdir -p *)
---

# Jugalbandi: review finished work

Adversarial review of a diff, with the same cold handoff the Challenger gets — the
reviewer judges what the code does, not what anyone says it does.

**Target:** $ARGUMENTS

## Steps

1. **Resolve the diff.** If the argument is a git ref or ref range, diff that. If it is
   a path, diff that path. If it is empty, use the working diff against the default
   branch. Write the raw diff to `${CLAUDE_PROJECT_DIR}/.jugalbandi/review-<slug>/diff.md`
   (create the directory first). Call that directory `REV`.

   If the diff is empty, say so and stop.

2. **Run the project's own checks first.** Find and run whatever this project uses —
   tests, type check, lint. Look at `package.json` scripts, a Makefile, or the CI
   workflow to find the real commands rather than guessing.

   **If they fail, report the failures and stop.** Adversarially reviewing code that
   does not pass its own tests is wasted compute — the tooling already found something
   cheaper and more reliably than a subagent will. Fix that first.

   If the project has no checks to run, say so in one line and continue.

3. **Assemble the decision list, if there is one.** Look for a Jugalbandi run covering
   this work: `${CLAUDE_PROJECT_DIR}/.jugalbandi/*/final-plan.md`. If one plausibly
   matches, copy its `## Dispositions` and `## Open Questions for the Human` sections —
   verbatim — into `REV/decisions.md`.

   If there is no matching plan, skip this. The review still runs; it just cannot
   produce `[DRIFT]` findings.

4. **Launch the `jugalbandi:reviewer` subagent.** Its prompt is exactly:

   > Read `REV/diff.md`. That diff is the entire change under review — it is all the
   > context you get. Write your findings to `REV/findings.md`.

   With a decision list, add exactly one more line:

   > `REV/decisions.md` lists decisions already made about this work. Treat it as the
   > specification the diff is answerable to.

   Nothing else goes in that prompt. In particular: no commit messages, no branch name,
   no pull request description, no summary of what you think the change does, and
   nothing from this conversation. Commit messages are the author's claim about intent
   — handing them over is exactly the context poisoning the cold read exists to avoid.

5. **Report.** Present the findings grouped by tag, with a one-line tally. Lead with
   any `[DRIFT]` findings and say plainly which decision each one contradicts — those
   are the ones where the code went somewhere nobody agreed to.

   Give the path to `REV/findings.md`.

## No Resolver

This is deliberately Challenger-only. It surfaces findings and stops.

On a plan, a Resolver dispositions challenges by rewriting text, and a wrong call
muddies a document. On a diff it would disposition by editing code, and a wrong
acceptance breaks something that currently works. That trade needs a test oracle strong
enough to catch a bad acceptance, and "the tests passed before the edit" is not that.

So decide the findings yourself, or feed them into `/jugalbandi:plan` if the fix is big
enough to deserve its own plan.
