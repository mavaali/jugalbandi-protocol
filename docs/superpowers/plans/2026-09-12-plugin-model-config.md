# Challenger Model Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Jugalbandi Challenger run on a non-Anthropic model, with the protocol's context-isolation guarantee proven by test rather than assumed.

**Architecture:** A dependency-free Node script inside the plugin (`run-role.mjs`) builds the Challenger's prompt from the existing `agents/challenger.md`, runs it through the `codex` CLI with ambient context neutralized, captures the CLI's final message as `challenges.md`, and validates that it actually contains tagged challenges before anyone reads it. The conductors branch on one decision: `claude` launches the native subagent as today, `codex` shells out to the script. Pure logic lives in small `lib/` modules that are unit-testable without invoking a model; only the probes call a real CLI.

**Tech Stack:** Node 22 ESM, no npm dependencies (matching `scripts/check-plugin.mjs`), `node --test` as the runner, `codex` CLI as the only external provider.

**Spec:** `docs/superpowers/specs/2026-09-12-plugin-model-config-design.md`

---

## Why only the Challenger

The spec designs per-role assignment for all four roles. This plan implements it for the Challenger alone, deliberately.

The Claude path costs nothing because the subagent harness *enforces* isolation structurally. An external CLI provides no such guarantee, so everything the harness gave for free — context isolation, a reliable artifact write, a persona bound to an output contract — has to be rebuilt by hand and then proven. That cost is per-provider, not per-role, but the surface it touches is per-role.

Restricting it to the Challenger buys three things:

- **It is where model diversity actually pays.** The Challenger is the adversarial role; a different model's different blind spots are the whole point of H3, and assumption-surfacing is driven by the challenge step.
- **It has the simplest artifact contract** — read one file, emit at least three tagged headings. No fenced structure template (as `resolver.md` has), no per-challenge disposition count, no arbitrary user text to pass safely (as the Proposer needs).
- **It keeps the rigor where it matters.** Both isolation probes stay. A leaking Challenger is precisely the failure that silently reduces this protocol to the self-critique baseline it is measured against.

Proposer, Resolver, and Reviewer stay on Claude. The config rejects them with a clear message rather than pretending otherwise. Extending later is mechanical; the probes and the adapter are the hard part and they are provider-shaped, not role-shaped.

## Critical context for the implementer

If isolation breaks, **nothing in the output looks wrong** — the run produces challenges, a tally, and artifacts, and is silently worthless. That is why Task 1 comes first and is not optional.

Four things were measured before this plan was written. Do not re-derive them; do not assume they survive a CLI upgrade either — that is what the probes are for.

1. `codex exec --sandbox read-only`, in a repo containing an `AGENTS.md`, answered a question about that file's contents *while being told not to read files*. It is preloaded before the prompt arrives. A Codex Challenger in a repo with an `AGENTS.md` would receive the task it must never see.
2. Adding `--ephemeral --ignore-user-config -c project_doc_max_bytes=0` closed it — same repo, same question, answer `UNKNOWN`. **Three flags changed at once**, so what is known is that the *set* works, not which member did the work. Never trim it by eye; re-run the probes if you change it.
3. `codex exec --sandbox read-only` will still run `git log` and report the result. Read-only blocks writes, not execution. This is an accepted divergence documented in the spec — do not try to "fix" it.
4. `gemini` exited **code 0** having done nothing. Exit status is not a success signal; the validated artifact is.

## File structure

**Create:**
- `plugins/jugalbandi/scripts/run-role.mjs` — adapter entry; spawn, timeout, capture, validate, write
- `plugins/jugalbandi/scripts/resolve-models.mjs` — CLI entry the conductor calls
- `plugins/jugalbandi/scripts/lib/providers.mjs` — argv; **sole owner of the neutralization flag set**
- `plugins/jugalbandi/scripts/lib/models.mjs` — config + flag resolution
- `plugins/jugalbandi/scripts/lib/role-prompt.mjs` — frontmatter strip, output-contract substitution
- `plugins/jugalbandi/scripts/lib/validate-artifact.mjs` — challenges.md structural validation
- `plugins/jugalbandi/scripts/probes/isolation.mjs` — Probes A and B; calls a real CLI
- `tests/models.test.mjs`, `tests/role-prompt.test.mjs`, `tests/validate-artifact.test.mjs`, `tests/providers.test.mjs`, `tests/run-role.test.mjs`

**Modify:**
- `plugins/jugalbandi/skills/plan/SKILL.md` — branch at the Challenger, both rounds
- `plugins/jugalbandi/skills/challenge/SKILL.md` — same branch
- `package.json:8`, `.github/workflows/plugin.yml`, `plugins/jugalbandi/README.md`

`skills/review/SKILL.md` and `agents/*.md` are **not modified**. `lib/` modules are pure and import nothing but `node:` builtins; everything touching a child process lives in the two entry scripts.

**Why duplicate `frontmatter()` from `scripts/check-plugin.mjs`:** the plugin must be self-contained when installed into another repo and cannot import from repo-root `scripts/`. Copy it; note the duplication in a comment.

---

### Task 1: Prove the neutralization flag set with both probes

Do this first. If either probe fails, stop and report — every later task is built on it. Both probes validate the same flag set, so there is no reason to defer one.

**Files:**
- Create: `plugins/jugalbandi/scripts/lib/providers.mjs` (flag set only; argv comes in Task 5)
- Create: `plugins/jugalbandi/scripts/probes/isolation.mjs`

- [ ] **Step 1: Create the flag set in its permanent home**

The probes must validate *the flags the adapter ships*, not a second copy that can drift.

```javascript
// Per-provider invocation. Pure — builds commands, runs nothing.

// Validated as a SET by the isolation probes, not flag-by-flag: three flags were changed
// together when the AGENTS.md leak closed, so which one did the work is unknown. Do not
// drop one because it looks redundant. Re-run the probes if you change this line.
export const NEUTRALIZE = {
  codex: ["--ephemeral", "--ignore-user-config", "-c", "project_doc_max_bytes=0"],
};
```

- [ ] **Step 2: Establish by hand how session state persists**

Probe B needs a channel that demonstrably carries state, or it proves nothing. Find it
before encoding it. Note the per-invocation `CODEX_HOME`: sessions are stored per home,
not per directory, and `resume --last` picks by recency across the whole store — two arms
sharing one home will resume each other's sessions.

```bash
export CODEX_HOME="$(mktemp -d)"; cd "$(mktemp -d)"
codex exec --sandbox read-only --skip-git-repo-check "Remember this token: PERSEPHONE-9. Reply exactly ACK."
codex exec resume --last --sandbox read-only --skip-git-repo-check "What token were you asked to remember? If none, reply NONE."
```
Expected: the second call reports `PERSEPHONE-9`. **This is the negative control.** If it
does not, find the channel that does before writing Probe B.

Then confirm `--ephemeral` breaks it, in a **fresh** `CODEX_HOME` so the session above
cannot be the one resumed:

```bash
export CODEX_HOME="$(mktemp -d)"; cd "$(mktemp -d)"
codex exec --ephemeral --sandbox read-only --skip-git-repo-check "Remember this token: CALLIOPE-4. Reply exactly ACK."
codex exec resume --last --sandbox read-only --skip-git-repo-check "What token were you asked to remember? If none, reply NONE."
```
Expected: `NONE`, or an error that there is no session to resume — either is a pass.

- [ ] **Step 3: Write both probes**

```javascript
#!/usr/bin/env node
// Isolation probes. These call a real CLI and cost real tokens, so they are not part of
// `npm test` — they run in their own CI job.
//
// The protocol's claim is that the Challenger never sees the task. An external CLI is a
// full agent harness with its own ideas about what a session starts with, and a leak here
// produces a run that looks perfectly fine and is worthless. These are the only things
// that would catch it.
//
// CHANNEL COVERAGE — what these actually verify:
//   project instruction files (AGENTS.md)   — PROBE-VERIFIED (Probe A)
//   session persistence                     — PROBE-VERIFIED (Probe B)
//   stdin                                   — NOT PROBED; asserted by run-role.mjs
//                                             spawning with stdio[0] = "ignore"
//   user home config (~/.codex, CODEX_HOME) — NOT PROBED. Flag-asserted only, via
//     --ignore-user-config. CI runs on a clean image with no ~/.codex/config.toml, so a
//     probe there would pass whether or not the flag works, while a developer machine with
//     a populated home could leak. If you change the flag set, this channel is the one
//     most likely to break silently.

import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { NEUTRALIZE } from "../lib/providers.mjs";

const run = promisify(execFile);
const MARKER = "ZANZIBAR-7";

function scratchRepo() {
  const dir = mkdtempSync(join(tmpdir(), "jb-probe-"));
  writeFileSync(
    join(dir, "AGENTS.md"),
    `# Project context\nThe current task is adding rate limiting to the payments service.\nThe magic word is ${MARKER}.\n`,
  );
  return dir;
}

// `resume` is a subcommand of `exec`, so it goes immediately after it.
async function codex(dir, prompt, { neutralized, resume = false, home = null }) {
  const args = [
    "exec",
    ...(resume ? ["resume", "--last"] : []),
    "--sandbox", "read-only", "--skip-git-repo-check",
    ...(neutralized ? NEUTRALIZE.codex : []),
    prompt,
  ];
  const { stdout } = await run("codex", args, {
    cwd: dir,
    env: home ? { ...process.env, CODEX_HOME: home } : process.env,
    timeout: 300_000,
  });
  return stdout;
}

const QUESTION =
  "What is the magic word for this project? If you do not know, reply exactly UNKNOWN. Do not read any files.";

export async function probeA() {
  const dir = scratchRepo();
  try {
    // The control must leak, or the probe proves nothing: a probe that cannot demonstrate
    // the failure it guards against is not evidence of a guard.
    const control = await codex(dir, QUESTION, { neutralized: false });
    if (!control.includes(MARKER)) {
      return { ok: false, why: "negative control did not leak — the probe is measuring nothing" };
    }
    const clean = await codex(dir, QUESTION, { neutralized: true });
    if (clean.includes(MARKER)) return { ok: false, why: `neutralized run leaked ${MARKER}` };
    return { ok: true };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const RECALL =
  "What token were you asked to remember? If you were not asked to remember one, reply exactly NONE.";
const remember = (tok) => `Remember this token for later: ${tok}. Reply exactly ACK.`;

/** Resume and read back. Distinguishes "nothing to resume" (the outcome we want) from
 *  "codex failed to run" (which proves nothing and must not read as a pass). */
async function readBack(dir, home, neutralized) {
  try {
    return { ran: true, text: await codex(dir, RECALL, { neutralized, resume: true, home }) };
  } catch (err) {
    const text = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    if (/no session|nothing to resume|not found/i.test(text)) return { ran: true, text: "" };
    return { ran: false, text };
  }
}

export async function probeB() {
  // The token is planted only in a PROMPT — in no file anywhere. The only path by which a
  // later invocation could know it is session persistence, the channel that would carry
  // one role's context into the next and collapse the protocol into self-critique.
  //
  // Each arm gets its own CODEX_HOME and its own token, and the neutralized arm runs
  // first. Sharing a home would let the neutralized arm resume the control's session and
  // report a false failure, stopping the project on a bug that isn't there.
  const arms = {
    clean: { dir: mkdtempSync(join(tmpdir(), "jb-pB-clean-")), home: mkdtempSync(join(tmpdir(), "jb-pB-hc-")), token: "CALLIOPE-4" },
    control: { dir: mkdtempSync(join(tmpdir(), "jb-pB-ctl-")), home: mkdtempSync(join(tmpdir(), "jb-pB-hx-")), token: "PERSEPHONE-9" },
  };
  try {
    const { dir: cd, home: ch, token: ct } = arms.clean;
    await codex(cd, remember(ct), { neutralized: true, home: ch });
    const after = await readBack(cd, ch, true);
    if (!after.ran) return { ok: false, why: `neutralized arm could not run codex: ${after.text.slice(-300)}` };
    if (after.text.includes(ct)) {
      return { ok: false, why: `neutralized run recalled ${ct} — sessions are persisting` };
    }

    const { dir: xd, home: xh, token: xt } = arms.control;
    await codex(xd, remember(xt), { neutralized: false, home: xh });
    const recalled = await readBack(xd, xh, false);
    if (!recalled.ran) return { ok: false, why: `control arm could not run codex: ${recalled.text.slice(-300)}` };
    if (!recalled.text.includes(xt)) {
      return { ok: false, why: "negative control did not persist — the probe is measuring nothing" };
    }
    return { ok: true };
  } finally {
    for (const a of Object.values(arms)) {
      rmSync(a.dir, { recursive: true, force: true });
      rmSync(a.home, { recursive: true, force: true });
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const results = {
    "Probe A (ambient context)": await probeA(),
    "Probe B (session persistence)": await probeB(),
  };
  let failed = false;
  for (const [name, r] of Object.entries(results)) {
    console.log(r.ok ? `✓ ${name}` : `✗ ${name}: ${r.why}`);
    if (!r.ok) failed = true;
  }
  process.exit(failed ? 1 : 0);
}
```

- [ ] **Step 4: Run both probes**

Run: `node plugins/jugalbandi/scripts/probes/isolation.mjs`
Expected: both `✓`. Six real model calls; allow several minutes.

**If a control arm fails, the probe is measuring nothing — fix the channel, do not relax the assertion. If a neutralized arm fails, stop and report.** Do not widen the flag set by guesswork.

- [ ] **Step 5: Commit**

```bash
git add plugins/jugalbandi/scripts/lib/providers.mjs plugins/jugalbandi/scripts/probes/isolation.mjs
git commit -m "Add isolation probes for ambient context and session persistence"
```

Note in the message what Probe B does and does not test: the adapter never passes `resume`, so it verifies that `--ephemeral` prevents a session being *written*, using explicit resumption as read-back. That is the right proxy, not a general proof of cross-role isolation.

---

### Task 2: Model resolution

**Files:**
- Create: `plugins/jugalbandi/scripts/lib/models.mjs`, `plugins/jugalbandi/scripts/resolve-models.mjs`
- Test: `tests/models.test.mjs`

The CLI entry matters: without it the conductor would re-implement these rules as SKILL.md prose, and the rejections below — which are specified error behaviors, not suggestions — would exist only as tested code that never runs.

- [ ] **Step 1: Write the failing tests**

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveChallenger, parseAssignment } from "../plugins/jugalbandi/scripts/lib/models.mjs";

test("bare provider parses with no model", () => {
  assert.deepEqual(parseAssignment("codex"), { provider: "codex", model: null });
});

test("provider:model splits on the first colon only", () => {
  assert.deepEqual(parseAssignment("codex:gpt-5.1:preview"), { provider: "codex", model: "gpt-5.1:preview" });
});

test("unknown provider is rejected", () => {
  assert.throws(() => parseAssignment("gpt4"), /unknown provider/i);
});

test("claude with a model is rejected rather than truncated", () => {
  // Per-role Claude tier selection is a stated non-goal. Accepting the string and
  // ignoring half of it would imply support that does not exist.
  assert.throws(() => parseAssignment("claude:opus"), /does not take a model/i);
});

test("absent config resolves to claude", () => {
  assert.deepEqual(resolveChallenger(null, null), { provider: "claude", model: null });
});

test("the flag overrides the config file", () => {
  assert.deepEqual(resolveChallenger({ models: { challenger: "codex" } }, "claude"),
    { provider: "claude", model: null });
});

test("config without a challenger entry resolves to claude", () => {
  assert.deepEqual(resolveChallenger({ models: {} }, null), { provider: "claude", model: null });
});

test("assigning a provider to any other role is rejected by name", () => {
  // Silently ignoring it would be the footgun: a user sets resolver=codex, sees a normal
  // run, and believes a model they never used produced the plan.
  assert.throws(
    () => resolveChallenger({ models: { resolver: "codex" } }, null),
    /only `challenger`/i,
  );
});

test("another role set to claude is accepted, since that is what it already is", () => {
  assert.doesNotThrow(() => resolveChallenger({ models: { resolver: "claude" } }, null));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/models.test.mjs`
Expected: FAIL — cannot find module `models.mjs`

- [ ] **Step 3: Implement the module**

```javascript
// Resolution order: config file, then the per-run flag. Nothing here touches the
// filesystem or a child process — the caller supplies parsed inputs.

const PROVIDERS = {
  claude: { takesModel: false },
  codex: { takesModel: true },
};

export function parseAssignment(value) {
  const idx = value.indexOf(":");
  const provider = idx === -1 ? value : value.slice(0, idx);
  const model = idx === -1 ? null : value.slice(idx + 1) || null;

  const spec = PROVIDERS[provider];
  if (!spec) {
    throw new Error(`unknown provider "${provider}" — expected one of ${Object.keys(PROVIDERS).join(", ")}`);
  }
  if (model && !spec.takesModel) {
    throw new Error(`provider "${provider}" does not take a model (got "${value}")`);
  }
  return { provider, model };
}

export function resolveChallenger(config, flag) {
  const models = config?.models ?? {};

  // Only the Challenger can run externally today. Rejecting the others loudly beats
  // ignoring them: a user who sets resolver=codex and sees a normal run would otherwise
  // believe a model they never used produced the plan.
  for (const [role, value] of Object.entries(models)) {
    if (role === "challenger") continue;
    if (value === "claude") continue;
    throw new Error(
      `only \`challenger\` may be assigned an external provider (got ${role}="${value}")`,
    );
  }

  return parseAssignment(flag ?? models.challenger ?? "claude");
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/models.test.mjs`
Expected: PASS, 9 tests

- [ ] **Step 5: Add the CLI entry**

```javascript
#!/usr/bin/env node
// Resolves the Challenger's model for the conductor, which cannot be trusted to
// re-implement the rules in prose.
//
// Usage: node resolve-models.mjs [--config <path>] [--challenger=<provider[:model]>]
// Prints the resolved assignment as JSON. Exits 1 with a message on any bad value.

import { readFileSync, existsSync } from "node:fs";
import { resolveChallenger } from "./lib/models.mjs";

const args = process.argv.slice(2);
let configPath = ".jugalbandi.json";
let flag = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--config") { configPath = args[++i]; continue; }
  const m = args[i].match(/^--challenger=(.+)$/);
  if (m) { flag = m[1]; continue; }
  console.error(`unexpected argument: ${args[i]}`);
  process.exit(1);
}

let config = null;
if (existsSync(configPath)) {
  try {
    config = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch (err) {
    console.error(`${configPath}: ${err.message}`);
    process.exit(1);
  }
}

try {
  console.log(JSON.stringify(resolveChallenger(config, flag), null, 2));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
```

- [ ] **Step 6: Verify the entry by hand**

Use a path that does not exist, **not `/dev/null`** — `/dev/null` exists and reads as `""`,
so `JSON.parse` throws and the command exits 1 on a parse error, appearing to pass an
exit-code check without ever reaching the branch under test.

```bash
node plugins/jugalbandi/scripts/resolve-models.mjs --config /nonexistent.json --challenger=codex
node plugins/jugalbandi/scripts/resolve-models.mjs --config /nonexistent.json --challenger=gpt4; echo "exit=$?"
```
Expected: the first prints `{"provider":"codex","model":null}`. The second prints a message
containing *"unknown provider"* and `exit=1`. **Check the message, not just the exit code.**

- [ ] **Step 7: Commit**

```bash
git add plugins/jugalbandi/scripts/lib/models.mjs plugins/jugalbandi/scripts/resolve-models.mjs tests/models.test.mjs
git commit -m "Add challenger model resolution"
```

---

### Task 3: Role prompt assembly

The external Challenger gets the same instructions the native subagent gets, with one section swapped: it returns the artifact instead of writing it.

**Files:**
- Create: `plugins/jugalbandi/scripts/lib/role-prompt.mjs`
- Test: `tests/role-prompt.test.mjs`

`challenger.md`'s `## Output contract` contains no fenced block, so a naive splice would work today. The finder is fence-aware anyway: `resolver.md`'s contract *does* contain a fence with `## Dispositions` at column 0, and if this is ever extended to that role a non-fence-aware splice would silently orphan a fence and leave two contradictory contracts in the prompt. Five lines now, versus a silent failure later.

- [ ] **Step 1: Write the failing tests**

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripFrontmatter, externalizeContract, buildPrompt }
  from "../plugins/jugalbandi/scripts/lib/role-prompt.mjs";

test("frontmatter is removed, body preserved", () => {
  const src = "---\nname: challenger\ntools: Read\n---\n\nYou are an adversarial reviewer.\n";
  assert.equal(stripFrontmatter(src).trim(), "You are an adversarial reviewer.");
});

test("a body with no frontmatter is returned unchanged", () => {
  assert.equal(stripFrontmatter("just text").trim(), "just text");
});

test("the output contract is replaced, not appended", () => {
  const body = "Do the work.\n\n## Output contract\n\nWrite to the path given.\n";
  const out = externalizeContract(body);
  assert.ok(!out.includes("Write to the path given"), "old contract must be gone");
  assert.equal(out.match(/## Output contract/g).length, 1, "exactly one contract section");
});

test("the external contract forbids writing and VCS inspection", () => {
  const out = externalizeContract("x\n\n## Output contract\n\nold\n");
  assert.match(out, /Write no files/);
  assert.match(out, /git log/);
});

test("a body with no contract section still gets one", () => {
  assert.match(externalizeContract("Just instructions.\n"), /## Output contract/);
});

test("sections after the contract survive", () => {
  const out = externalizeContract("Intro.\n\n## Output contract\n\nold\n\n## Notes\n\nkeep me\n");
  assert.match(out, /## Notes/);
  assert.match(out, /keep me/);
  assert.ok(!out.includes("old"));
});

test("a `## ` inside a fenced block is not a section boundary", () => {
  // Not hypothetical: resolver.md's contract contains exactly this shape. A naive splice
  // cuts inside the fence, orphaning it and retaining the old contract below the new one.
  const body = "Intro.\n\n## Output contract\n\n```\n## Not A Heading\n```\n\n## Real\n\nkeep\n";
  const out = externalizeContract(body);
  assert.equal((out.match(/```/g) ?? []).length, 0, "the fenced sample was inside the contract");
  assert.match(out, /## Real/);
  assert.match(out, /keep/);
});

test("the real challenger.md produces a coherent prompt", () => {
  const out = externalizeContract(
    stripFrontmatter(readFileSync("plugins/jugalbandi/agents/challenger.md", "utf-8")),
  );
  assert.ok(!/using the `Write`\s*\n?tool/.test(out), "old write instruction must be gone");
  assert.match(out, /Write no files/);
  assert.match(out, /adversarial reviewer/);
  assert.match(out, /\[STRUCTURAL\]/, "the tag vocabulary must survive — validation depends on it");
});

test("buildPrompt puts instructions before the isolated message", () => {
  const p = buildPrompt("INSTRUCTIONS", "MESSAGE");
  assert.ok(p.indexOf("INSTRUCTIONS") < p.indexOf("MESSAGE"));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/role-prompt.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```javascript
// Builds the prompt for the external Challenger. The instructions are the role's own
// agents/challenger.md body — identical to what the native subagent gets — with the output
// contract swapped, because an external role returns its artifact instead of writing it.
//
// NOTE: stripFrontmatter duplicates the helper in scripts/check-plugin.mjs. The duplication
// is deliberate — the plugin must be self-contained when installed into another repository
// and cannot import from this repo's scripts/.

// Kept on single lines: these sentences are asserted against in tests, and rewrapping them
// silently breaks those assertions.
const EXTERNAL_CONTRACT = [
  "## Output contract",
  "",
  "Return the complete artifact as your final message, and nothing else.",
  "Write no files. The caller captures your final message and writes it for you.",
  "Do not call any file-writing tool.",
  "",
  "Do not inspect version control: no `git log`, `git diff`, `git show`, or `git reflog`.",
  "What you were given is the whole context you get, and reconstructing more from",
  "repository history defeats the purpose of this role.",
  "",
  'Emit the artifact content only — no preamble, no "here is my analysis", no closing',
  "summary. Your entire final message is written to a file verbatim.",
];

export function stripFrontmatter(text) {
  const m = text.match(/^---\n[\s\S]*?\n---\n/);
  return m ? text.slice(m[0].length) : text;
}

export function externalizeContract(body) {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => /^## Output contract\s*$/.test(l));
  if (start === -1) return `${body.trimEnd()}\n\n${EXTERNAL_CONTRACT.join("\n")}\n`;

  // Fence-aware: a `## ` inside a fenced block is sample output, not a section boundary.
  let inFence = false;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) { inFence = !inFence; continue; }
    if (!inFence && /^## /.test(lines[i])) { end = i; break; }
  }

  const out = [...lines.slice(0, start), ...EXTERNAL_CONTRACT, "", ...lines.slice(end)];
  return `${out.join("\n").trimEnd()}\n`;
}

export function buildPrompt(instructions, isolatedMessage) {
  return `${instructions.trimEnd()}\n\n---\n\n${isolatedMessage.trim()}\n`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/role-prompt.test.mjs`
Expected: PASS, 9 tests

- [ ] **Step 5: Read the generated prompt once**

```bash
node -e "
const fs=require('node:fs');
import('./plugins/jugalbandi/scripts/lib/role-prompt.mjs').then(m=>
  console.log(m.externalizeContract(m.stripFrontmatter(
    fs.readFileSync('plugins/jugalbandi/agents/challenger.md','utf-8')))));"
```

The tests check for absence of the old instruction; you are checking the result still reads
as coherent instructions to a model.

- [ ] **Step 6: Commit**

```bash
git add plugins/jugalbandi/scripts/lib/role-prompt.mjs tests/role-prompt.test.mjs
git commit -m "Add external-challenger prompt assembly"
```

---

### Task 4: Artifact validation

This closes the hole the no-write design opens. The adapter writes whatever the model said
last, so *"I've analyzed the proposal and identified 5 challenges above"* is non-empty,
lands in `challenges.md`, and yields a tally of zero — reported as a clean result.

**Files:**
- Create: `plugins/jugalbandi/scripts/lib/validate-artifact.mjs`
- Test: `tests/validate-artifact.test.mjs`

- [ ] **Step 1: Write the failing tests**

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateChallenges } from "../plugins/jugalbandi/scripts/lib/validate-artifact.mjs";

test("a prose summary is rejected", () => {
  const r = validateChallenges("I've analyzed the proposal and identified 5 challenges above.");
  assert.equal(r.ok, false);
  assert.ok(r.missing.length > 0);
});

test("empty content is rejected", () => {
  assert.equal(validateChallenges("   \n  ").ok, false);
});

test("three tagged headings are required", () => {
  const two = "### [STRUCTURAL] a\nbody\n### [MISSING] b\nbody\n";
  assert.equal(validateChallenges(two).ok, false);
  assert.equal(validateChallenges(two + "### [ASSUMPTION] c\nbody\n").ok, true);
});

test("an invented tag does not count", () => {
  assert.equal(validateChallenges("### [NITPICK] a\n### [NITPICK] b\n### [NITPICK] c\n").ok, false);
});

test("a heading with no claim text does not count", () => {
  // The agent file requires `### [TAG] <one-line claim>`. A bare tag is not a challenge.
  assert.equal(validateChallenges("### [STRUCTURAL]\n### [MISSING]\n### [ASSUMPTION]\n").ok, false);
});

test("the failure says what was missing", () => {
  assert.match(validateChallenges("nope").missing.join(" "), /three/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/validate-artifact.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```javascript
// Structural validation for the artifact an external Challenger produces.
//
// A native subagent writes its artifact with a tool call; it exists or it doesn't. An
// external role's artifact is whatever it said last, so "non-empty" is not a sufficient
// bar — a prose summary passes that and then degrades every downstream consumer silently.
// The conductor counts these same tags to build its tally and would report zero as a clean
// result.

const TAGGED = /^### \[(STRUCTURAL|ASSUMPTION|MISSING)\] \S/gm;

export function validateChallenges(content) {
  if (!content || !content.trim()) return { ok: false, missing: ["any content at all"] };

  const count = (content.match(TAGGED) ?? []).length;
  if (count < 3) {
    return {
      ok: false,
      missing: [`at least three '### [TAG] <claim>' headings tagged STRUCTURAL, ASSUMPTION or MISSING (found ${count})`],
    };
  }
  return { ok: true, missing: [] };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/validate-artifact.test.mjs`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add plugins/jugalbandi/scripts/lib/validate-artifact.mjs tests/validate-artifact.test.mjs
git commit -m "Add structural validation for external challenger output"
```

---

### Task 5: Provider argv construction

**Files:**
- Modify: `plugins/jugalbandi/scripts/lib/providers.mjs`
- Test: `tests/providers.test.mjs`

- [ ] **Step 1: Write the failing tests**

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInvocation, NEUTRALIZE } from "../plugins/jugalbandi/scripts/lib/providers.mjs";

const base = { provider: "codex", model: null, prompt: "P", cwd: "/repo", lastMessageFile: "/tmp/last" };

test("the invocation carries the full neutralization set", () => {
  const { command, args } = buildInvocation(base);
  assert.equal(command, "codex");
  for (const flag of NEUTRALIZE.codex) assert.ok(args.includes(flag), `missing ${flag}`);
  assert.ok(args.includes("--sandbox") && args.includes("read-only"));
});

test("the prompt is a single argv element, never shell-interpolated", () => {
  // A prompt containing a backtick or $ must be inert. Passing argv as an array is what
  // makes that true; this test pins the shape that guarantees it.
  const nasty = "`rm -rf /` $(whoami)";
  assert.ok(buildInvocation({ ...base, prompt: nasty }).args.includes(nasty));
});

test("a model is passed only when specified", () => {
  assert.ok(!buildInvocation(base).args.includes("-m"));
  const args = buildInvocation({ ...base, model: "gpt-5.1-codex" }).args;
  assert.deepEqual(args.slice(args.indexOf("-m"), args.indexOf("-m") + 2), ["-m", "gpt-5.1-codex"]);
});

test("claude has no invocation — it never goes through the adapter", () => {
  assert.throws(() => buildInvocation({ ...base, provider: "claude" }), /native subagent/i);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/providers.test.mjs`
Expected: FAIL — `buildInvocation` is not exported

- [ ] **Step 3: Add `buildInvocation` below the existing `NEUTRALIZE`**

```javascript
export function buildInvocation({ provider, model, prompt, cwd, lastMessageFile }) {
  if (provider === "claude") {
    throw new Error("claude runs as a native subagent and never goes through the adapter");
  }
  if (provider !== "codex") throw new Error(`unknown provider "${provider}"`);

  return {
    command: "codex",
    args: [
      "exec",
      "--sandbox", "read-only",
      "--skip-git-repo-check",
      ...NEUTRALIZE.codex,
      "-C", cwd,
      "-o", lastMessageFile,
      ...(model ? ["-m", model] : []),
      prompt,
    ],
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/providers.test.mjs`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add plugins/jugalbandi/scripts/lib/providers.mjs tests/providers.test.mjs
git commit -m "Add codex invocation construction"
```

---

### Task 6: The adapter

**Files:**
- Create: `plugins/jugalbandi/scripts/run-role.mjs`
- Test: `tests/run-role.test.mjs`

Two details that will waste your time if you get them wrong:

- **`execFile` silently ignores `stdio`.** Node forwards only `cwd/env/gid/uid/shell/signal/windowsHide/windowsVerbatimArguments` to `spawn`. The spec requires the child not inherit stdin, and `codex exec` is on record printing *"Reading additional input from stdin…"* — an inherited-but-never-closed stdin is a plausible ten-minute hang that the fake-CLI tests cannot reproduce. Use `spawn`.
- **The tests must not reach the real `codex`,** which is installed on your machine (Task 1 requires it). Prepending the fake to `PATH` lets lookup fall through to it. Replace `PATH` — but not with `bin` alone: `env` *replaces* rather than extends, and the fake is a shell script needing `sleep` and `cat`. `${bin}:/usr/bin:/bin` supplies coreutils and contains no `codex`. Launch the child with `process.execPath` so replacing `PATH` doesn't break finding `node`.

- [ ] **Step 1: Write the failing tests**

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const SCRIPT = resolve("plugins/jugalbandi/scripts/run-role.mjs");

/** A stand-in `codex` that writes `body` to the path given after -o. */
function fakeCodex(dir, { body = "", exitCode = 0, sleep = 0 } = {}) {
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(dir, "payload.txt"), body);
  writeFileSync(join(bin, "codex"), `#!/bin/sh
if [ "$1" = "--version" ]; then echo "codex-cli 9.9.9-fake"; exit 0; fi
sleep ${sleep}
out=""
while [ $# -gt 0 ]; do
  case "$1" in -o) out="$2"; shift 2;; *) shift;; esac
done
[ -n "$out" ] && cat "${join(dir, "payload.txt")}" > "$out"
exit ${exitCode}
`);
  chmodSync(join(bin, "codex"), 0o755);
  return bin;
}

async function invoke(dir, bin, extra = []) {
  const out = join(dir, "challenges.md");
  return run(process.execPath, [
    SCRIPT, "--provider", "codex", "--cwd", dir,
    "--input", join(dir, "proposal.md"), "--output", out, ...extra,
  ], { env: { PATH: `${bin}:/usr/bin:/bin` } })
    .then((r) => ({ ...r, out }))
    .catch((e) => ({ error: e, out }));
}

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "jb-"));
  writeFileSync(join(dir, "proposal.md"), "a proposal");
  return dir;
}

const GOOD = "### [STRUCTURAL] a\nx\n### [MISSING] b\nx\n### [ASSUMPTION] c\nx\n";

test("a well-formed artifact is written verbatim", async () => {
  const dir = scratch();
  const r = await invoke(dir, fakeCodex(dir, { body: GOOD }));
  assert.ok(!r.error, r.error?.stderr);
  assert.equal(readFileSync(r.out, "utf-8"), GOOD);
});

test("the CLI version is reported for the audit trail", async () => {
  const dir = scratch();
  const r = await invoke(dir, fakeCodex(dir, { body: GOOD }));
  assert.ok(!r.error, r.error?.stderr);
  const line = r.stdout.split("\n").find((l) => l.startsWith("jugalbandi-role:"));
  assert.ok(line, "must print a machine-readable summary line");
  const meta = JSON.parse(line.replace("jugalbandi-role:", ""));
  assert.equal(meta.cliVersion, "codex-cli 9.9.9-fake");
  assert.ok(Array.isArray(meta.neutralize) && meta.neutralize.length > 0);
});

test("a prose summary fails and leaves no artifact behind", async () => {
  const dir = scratch();
  const r = await invoke(dir, fakeCodex(dir, { body: "I found 5 challenges above." }));
  assert.ok(r.error, "must exit non-zero");
  assert.match(r.error.stderr, /three/);
  assert.ok(!existsSync(r.out), "a half-valid artifact must not be written");
});

test("exit code 0 with no output is still a failure", async () => {
  // Measured: gemini exits 0 on an auth failure having done nothing. The validated
  // artifact is the only success signal; the exit code is not.
  const dir = scratch();
  const r = await invoke(dir, fakeCodex(dir, { body: "", exitCode: 0 }));
  assert.ok(r.error, "must exit non-zero");
});

test("a timeout kills the child", async () => {
  const dir = scratch();
  const r = await invoke(dir, fakeCodex(dir, { body: GOOD, sleep: 5 }), ["--timeout", "1"]);
  assert.ok(r.error);
  assert.match(r.error.stderr, /timed out/i);
});

test("a missing binary is reported clearly", async () => {
  const dir = scratch();
  mkdirSync(join(dir, "empty-bin"), { recursive: true });
  const r = await invoke(dir, join(dir, "empty-bin"));
  assert.ok(r.error);
  assert.match(r.error.stderr, /not on PATH/i);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/run-role.test.mjs`
Expected: FAIL — `run-role.mjs` not found

- [ ] **Step 3: Implement**

```javascript
#!/usr/bin/env node
// Runs the Jugalbandi Challenger on an external CLI and writes challenges.md.
//
// The role is handed exactly what a native subagent would be handed and nothing more.
// That is asserted by the isolation probes, not by reading the flags. The artifact is the
// CLI's final message, structurally validated before it is written — see
// lib/validate-artifact.mjs for why "non-empty" is not a sufficient bar.

import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildInvocation, NEUTRALIZE } from "./lib/providers.mjs";
import { stripFrontmatter, externalizeContract, buildPrompt } from "./lib/role-prompt.mjs";
import { validateChallenges } from "./lib/validate-artifact.mjs";

// Resolve the plugin's own files from this script's location — not from cwd, which is the
// target project, and not from an env var. $CLAUDE_PROJECT_DIR is unset in headless runs
// and expands to the filesystem root, a bug this repo has already been bitten by.
const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let scratch = null;
function die(msg) {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  console.error(msg);
  process.exit(1);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith("--")) die(`unexpected argument: ${argv[i]}`);
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out; // --key value pairs only, by design
}

const args = parseArgs(process.argv.slice(2));
const { provider, model = null, cwd = process.cwd(), input, output } = args;
if (!provider || !input || !output) die("--provider, --input and --output are required");

const roleFile = join(PLUGIN, "agents", "challenger.md");
if (!existsSync(roleFile)) die(`no role definition at ${roleFile}`);

// Verbatim from plan/SKILL.md, minus the "write your challenges to <path>" clause, which
// no longer applies. Nothing else goes in this prompt — not the task, not any context.
const isolatedMessage =
  `Read \`${input}\`. That file is the entire proposal under review — it is all the context you get.`;

const instructions = externalizeContract(stripFrontmatter(readFileSync(roleFile, "utf-8")));
const prompt = buildPrompt(instructions, isolatedMessage);

scratch = mkdtempSync(join(tmpdir(), "jb-role-"));
const lastMessageFile = join(scratch, "last-message.txt");

let invocation;
try {
  invocation = buildInvocation({ provider, model, prompt, cwd, lastMessageFile });
} catch (err) {
  die(`challenger: ${err.message}`);
}

const timeoutSec = args.timeout === undefined ? 600 : Number(args.timeout);
if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) die("--timeout must be a positive number of seconds");

// spawn, not execFile: execFile silently drops `stdio`, leaving the child an open stdin
// pipe. codex exec reads stdin when it is open, and would wait on it forever.
const child = spawn(invocation.command, invocation.args, { cwd, stdio: ["ignore", "pipe", "pipe"] });

let stderr = "";
child.stderr.on("data", (d) => { stderr += d; });
child.stdout.on("data", () => {}); // drained so the pipe cannot fill and block

const timer = setTimeout(() => {
  child.kill("SIGKILL");
  die(`challenger: ${invocation.command} timed out after ${timeoutSec}s`);
}, timeoutSec * 1000);

child.on("error", (err) => {
  clearTimeout(timer);
  if (err.code === "ENOENT") {
    die(`challenger: \`${invocation.command}\` is not on PATH — install it, or set challenger back to claude`);
  }
  die(`challenger: ${err.message}`);
});

child.on("close", (code) => {
  clearTimeout(timer);

  const content = existsSync(lastMessageFile) ? readFileSync(lastMessageFile, "utf-8") : "";

  // Checked before the exit code, deliberately: a CLI can exit 0 having done nothing, so
  // the validated artifact is the only success signal there is.
  const verdict = validateChallenges(content);
  if (!verdict.ok) {
    die(`challenger: ${invocation.command} produced no usable artifact — missing ${verdict.missing.join("; ")}.\n`
      + `--- stderr ---\n${stderr.slice(-2000)}`);
  }
  if (code !== 0) die(`challenger: ${invocation.command} exited ${code}\n${stderr.slice(-2000)}`);

  writeFileSync(output, content);

  let cliVersion = "unknown";
  try {
    cliVersion = execFileSync(invocation.command, ["--version"], {
      encoding: "utf-8",
      timeout: 10_000,   // the artifact is already written; never hang on bookkeeping
    }).trim();
  } catch { /* a missing version is not fatal */ }

  // Machine-readable so the conductor can record it. The flag set goes too: a version says
  // which runs a CLI upgrade affected, the flags say whether those runs were neutralized.
  console.log(`jugalbandi-role:${JSON.stringify({
    role: "challenger", provider, model, cliVersion, neutralize: NEUTRALIZE[provider] ?? [], output,
  })}`);

  rmSync(scratch, { recursive: true, force: true });
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/run-role.test.mjs`
Expected: PASS, 6 tests

- [ ] **Step 5: Run the whole unit suite**

Run: `node --test "tests/*.test.mjs"`
Expected: PASS, 34 tests (9 + 9 + 6 + 4 + 6)

**Not `node --test tests/`.** On Node 22 a bare directory argument is treated as a module
to import and reports `# tests 1 / # pass 0 / # fail 1` — which reads like one failing test
rather than zero discovered. Verified.

- [ ] **Step 6: Commit**

```bash
git add plugins/jugalbandi/scripts/run-role.mjs tests/run-role.test.mjs
git commit -m "Add the external-challenger adapter"
```

---

### Task 7: Wire both conductors

**Files:**
- Modify: `plugins/jugalbandi/skills/plan/SKILL.md`, `plugins/jugalbandi/skills/challenge/SKILL.md`

- [ ] **Step 1: Widen both frontmatter allowlists**

In a headless run an unpermitted Bash call is denied rather than prompted — the mode
`plan/SKILL.md` step 7 goes out of its way to support. Note the glob on `cat`: a conductor
naturally writes `cat .jugalbandi.json 2>/dev/null` for a file that may not exist, which an
exact-match entry would not permit.

```yaml
# plan
allowed-tools: Bash(mkdir -p *), Bash(date *), Bash(node *), Bash(cat .jugalbandi.json*)
# challenge
allowed-tools: Bash(mkdir -p *), Bash(node *), Bash(cat .jugalbandi.json*)
```

- [ ] **Step 2: Extend the flag-stripping paragraph in `plan/SKILL.md`**

The paragraph that strips `--rounds 2` must also strip `--challenger=` before the task text
reaches the Proposer.

- [ ] **Step 3: Add resolution as step 1.5 of `plan/SKILL.md`**

```markdown
1.5 **Resolve the Challenger's model.** Run:

    ```
    node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-models.mjs" [--challenger=X]
    ```

    It reads `.jugalbandi.json` if present, applies the flag, and prints the resolved
    assignment as JSON. A non-zero exit means a bad value — report its message and stop
    before launching anything. Do not re-implement its rules here; in particular, only the
    Challenger may be assigned an external provider, and it says so by name.

    Write that JSON to `RUN/models.json`. When the Challenger runs externally it prints a
    `jugalbandi-role:{...}` line carrying its CLI version and neutralization flags — merge
    that in. A version says which runs a CLI upgrade affected; the flags say whether those
    runs were actually neutralized.
```

- [ ] **Step 4: Add the branch at the Challenger step**

In `plan/SKILL.md` step 3, and again in "The second round" item 2 — the second round
launches the Challenger from its own section, and missing it would silently run round 2 on
`claude` while `RUN/models.json` claims otherwise, the false record this design forbids.

```markdown
   If the Challenger resolved to `claude`, launch the subagent exactly as described above.
   Otherwise run the adapter instead, and do not launch the subagent:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/run-role.mjs" --provider <p> [--model <m>] \
     --cwd "$(pwd)" --input RUN/proposal.md --output RUN/challenges.md
   ```

   A non-zero exit stops the run. Report the script's stderr verbatim and do not fall back
   to `claude` — a silent substitution would make `RUN/models.json` a false record, which
   is worse than a failed run.
```

**Verify `${CLAUDE_PLUGIN_ROOT}` before relying on it.** It is unconfirmed. Test it in a
headless `claude -p` run. If it is unset there, this is the same class of bug as the
`$CLAUDE_PROJECT_DIR` warning already in this file — pick a documented convention and fail
loudly when the script is absent, never skip the external role silently.

- [ ] **Step 5: Add the same branch to `challenge/SKILL.md` step 2**

Same shape, using that skill's own paths, resolving with no flag (it takes none). No
`models.json` — that skill has no audit-trail machinery.

- [ ] **Step 6: Add the report line to `plan/SKILL.md` step 6**

```markdown
   - One line naming the Challenger's model, marking it external so the weaker isolation
     guarantee is visible in the report and not only in a file:
     `Challenger: codex (external) — prompt-level isolation, see RUN/models.json`
```

- [ ] **Step 7: Verify the plugin still validates**

Run: `claude plugin validate ./plugins/jugalbandi --strict && node scripts/check-plugin.mjs`
Expected: both pass

- [ ] **Step 8: Commit**

```bash
git add plugins/jugalbandi/skills/plan/SKILL.md plugins/jugalbandi/skills/challenge/SKILL.md
git commit -m "Wire external challenger dispatch into plan and challenge"
```

---

### Task 8: CI, test script, and docs

**Files:**
- Modify: `package.json:8`, `.github/workflows/plugin.yml`, `plugins/jugalbandi/README.md`

- [ ] **Step 1: Replace the test stub**

```json
"test": "node --test \"tests/*.test.mjs\""
```

A bare `tests/` argument discovers nothing on Node 22 and reports a phantom failure. This
is also the command `/jugalbandi:review` runs as "the project's own checks", so getting it
wrong would halt every review.

- [ ] **Step 2: Add unit tests to the existing validate job**

```yaml
      - name: Unit tests
        run: npm test
```

- [ ] **Step 3: Add the probes as their own job**

They cost real tokens and need an authenticated CLI, so they cannot gate every pull request
the way the static checks do. They must still run on a schedule: a CLI upgrade that
silently reopens a context channel is the failure mode, and nothing else would catch it.

```yaml
  isolation:
    name: Isolation probes
    runs-on: ubuntu-latest
    if: github.event_name == 'workflow_dispatch' || github.event_name == 'schedule'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - name: Install Codex CLI
        run: npm install -g @openai/codex
      - name: Run probes
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: node plugins/jugalbandi/scripts/probes/isolation.mjs
```

Add a weekly `schedule:` trigger alongside the existing `on:` keys. **Confirm first** that
`codex` honours `OPENAI_API_KEY` under `--ignore-user-config` — that flag is in the
neutralization set, and if it also suppresses credential loading the job will fail weekly
for an auth reason nobody reads.

- [ ] **Step 4: Document it**

In `plugins/jugalbandi/README.md`: `.jugalbandi.json`, that only the Challenger may go
external and why, the `--challenger=` flag, and — most importantly — that an external
Challenger's isolation is prompt-level rather than structural and that it can read
`git log`. Someone choosing a provider should know what they are trading.

- [ ] **Step 5: Verify everything**

Run: `npm test && claude plugin validate ./plugins/jugalbandi --strict && node scripts/check-plugin.mjs`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add package.json .github/workflows/plugin.yml plugins/jugalbandi/README.md
git commit -m "Add test script, isolation probe CI job, and challenger config docs"
```

---

## Done means

- `node --test "tests/*.test.mjs"` passes, 34 tests. (Not `node --test tests/` — that discovers nothing and reports a phantom failure.)
- Both probes pass, **including each one's negative control actually failing** — a green probe whose control arm cannot fail is not evidence.
- `/jugalbandi:plan` with no config file produces artifacts and a report identical in shape to today's.
- `/jugalbandi:plan --challenger=codex --rounds 2` runs the Challenger on codex in **both** rounds, and `RUN/models.json` names the provider, CLI version, and neutralization flags.
- A config assigning any role other than `challenger` to an external provider stops the run and names that role, rather than ignoring it.
- `/jugalbandi:challenge` honours `.jugalbandi.json` without needing a flag.
