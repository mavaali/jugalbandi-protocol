---
name: review
description: Adversarially review finished work rather than a plan. Runs the project's own checks first, then hands a cold reviewer the diff — no commit messages, no intent, no conversation — and reports tagged findings. When a Jugalbandi plan exists for the work, also checks the diff for drift against the decisions that plan already made. Use before opening a pull request or after implementing a plan.
argument-hint: "[git ref, path, or blank for the working diff]"
allowed-tools: Bash(git diff *), Bash(git status *), Bash(git rev-parse *), Bash(git symbolic-ref *), Bash(mkdir -p *)
---

# Jugalbandi: review finished work

Adversarial review of a diff, with the same cold handoff the Challenger gets — the
reviewer judges what the code does, not what anyone says it does.

**Target:** $ARGUMENTS

## Steps

1. **Resolve the diff.** If the argument is a git ref or ref range, diff that. If it is
   a path, diff that path. If it is empty, diff against the repository's default branch.

   Resolve that branch, don't assume it. `git symbolic-ref refs/remotes/origin/HEAD`
   gives it; fall back to whichever of `main` or `master` exists. Hardcoding `main`
   silently produces an empty or nonsensical diff on any repo that uses something else.

   Pick a short kebab-case slug: the ref range with slashes and dots replaced by
   hyphens, or the branch name for a working diff. If
   `${CLAUDE_PROJECT_DIR}/.jugalbandi/review-<slug>/` already exists, append `-2`, `-3`,
   and so on rather than overwriting a previous review. Write the raw diff to
   `review-<slug>/diff.md` (create the directory first). Call that directory `REV`.

   If the diff is empty, say so and stop.

2. **Run the project's own checks first.** Find and run whatever this project uses —
   tests, type check, lint. Look at `package.json` scripts, a Makefile, or the CI
   workflow to find the real commands rather than guessing.

   **If a real check fails, report the failures and stop.** Adversarially reviewing code
   that does not pass its own tests is wasted compute — the tooling already found
   something cheaper and more reliably than a subagent will. Fix that first.

   A placeholder is not a real check. `npm init` writes
   `"test": "echo \"Error: no test specified\" && exit 1"` by default, and a great many
   repositories never replace it. A script that only prints a message and exits without
   executing anything means *no tests configured* — treat it as an absent check, not a
   failure, and continue. Halting there would make this skill refuse to run on a large
   share of real projects.

   Distinguish the two by what the command does, not by its exit code: a check that
   compiled, linted, or executed tests and then reported a problem is a stop; a stub
   that never ran anything is not.

   If you cannot run the checks at all — no permission, missing toolchain — say so
   explicitly and continue. Do not hand-simulate them and report the result as if they
   ran; an unexecuted check reported as passing is worse than an absent one.

   If the project has no checks to run, say so in one line and continue.

3. **Assemble the decision list, if there is one.** Look for a Jugalbandi run covering
   this work: `${CLAUDE_PROJECT_DIR}/.jugalbandi/*/final-plan.md`. Copy its
   `## Dispositions` and `## Open Questions for the Human` sections — verbatim — into
   `REV/decisions.md`.

   Only attach a plan you can justify attaching: its revised plan must name files the
   diff actually touches. A plan that merely sounds related is worse than no plan —
   every `[DRIFT]` finding it produces will be confidently wrong, measured against
   decisions that were never about this change. If more than one run could match, or
   none clearly does, say which you found and ask the user rather than guessing.

   With no decision list the review still runs; it just cannot produce `[DRIFT]`
   findings. Say so in one line so the absence isn't mistaken for a clean drift result.

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
