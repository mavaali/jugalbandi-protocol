# Per-Role Model Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each Jugalbandi role run on a different provider, with the protocol's context-isolation guarantee proven by test rather than assumed.

**Architecture:** A dependency-free Node script inside the plugin (`run-role.mjs`) builds a role's prompt from its existing `agents/<role>.md`, runs it through an external CLI with ambient context neutralized, captures the CLI's final message as the artifact, and validates that artifact's structure before anyone reads it. The three SKILL.md conductors branch per role: `claude` launches the native subagent as today, anything else shells out to the script. Pure logic lives in small `lib/` modules that are unit-testable without invoking a model; only the probes call a real CLI.

**Tech Stack:** Node 22 ESM, no npm dependencies (matching `scripts/check-plugin.mjs`), `node --test` as the runner, `codex` CLI as the only enabled external provider.

**Spec:** `docs/superpowers/specs/2026-09-12-plugin-model-config-design.md`

---

## Critical context for the implementer

You are building plumbing for a protocol whose entire claim is that three roles never see each other's context. If that isolation breaks, **nothing in the output looks wrong** — the run produces a plan, a tally, and artifacts, and is silently worthless. This is why Task 1 comes first and why it is not optional.

Four things were measured before this plan was written. Do not re-derive them; do not assume they survive a CLI upgrade either — that is what the probes are for.

1. `codex exec --sandbox read-only`, in a repo containing an `AGENTS.md`, answered a question about that file's contents *while being told not to read files*. It is preloaded before the prompt arrives.
2. Adding `--ephemeral --ignore-user-config -c project_doc_max_bytes=0` closed it — same repo, same question, answer `UNKNOWN`. **Three flags changed at once**, so what is known is that the *set* works, not which member did the work. Never trim it by eye; re-run the probes if you change it.
3. `codex exec --sandbox read-only` will still run `git log` and report the result. Read-only blocks writes, not execution. This is an accepted divergence documented in the spec — do not try to "fix" it.
4. `gemini` exited **code 0** having done nothing. Exit status is not a success signal anywhere in this codebase; the validated artifact is.

## File structure

**Create:**
- `plugins/jugalbandi/scripts/run-role.mjs` — CLI entry; spawn, timeout, capture, validate, write
- `plugins/jugalbandi/scripts/resolve-models.mjs` — CLI entry the conductor calls to resolve assignments
- `plugins/jugalbandi/scripts/lib/providers.mjs` — per-provider argv; **sole owner of the neutralization flag set**
- `plugins/jugalbandi/scripts/lib/models.mjs` — config + flag resolution, provider status
- `plugins/jugalbandi/scripts/lib/role-prompt.mjs` — frontmatter strip, output-contract substitution
- `plugins/jugalbandi/scripts/lib/validate-artifact.mjs` — per-role structural validation
- `plugins/jugalbandi/scripts/probes/isolation.mjs` — Probes A and B; calls a real CLI
- `tests/models.test.mjs`, `tests/role-prompt.test.mjs`, `tests/validate-artifact.test.mjs`, `tests/providers.test.mjs`, `tests/run-role.test.mjs`

**Modify:**
- `plugins/jugalbandi/skills/plan/SKILL.md` — branch per role (both rounds), flags, `models.json`, report line
- `plugins/jugalbandi/skills/challenge/SKILL.md`, `plugins/jugalbandi/skills/review/SKILL.md`
- `package.json:8` — replace the `test` stub
- `.github/workflows/plugin.yml` — unit tests in the existing job; probes in their own
- `plugins/jugalbandi/README.md`, `README.md`

`lib/` modules are pure and import nothing but `node:` builtins. Everything touching a child process lives in the two entry scripts. That split is what makes most of this testable without burning model calls.

**Why duplicate `frontmatter()` from `scripts/check-plugin.mjs`:** the plugin must be self-contained when installed into another repo and cannot import from repo-root `scripts/`. Copy it; note the duplication in a comment.

---

### Task 1: Lock the neutralization flag set as an executable probe

Do this first. If it fails, stop and report — every later task is built on it.

**Files:**
- Create: `plugins/jugalbandi/scripts/lib/providers.mjs` (the flag set only; argv comes in Task 5)
- Create: `plugins/jugalbandi/scripts/probes/isolation.mjs`

- [ ] **Step 1: Create the flag set in its permanent home**

The probes must validate *the flags the adapter actually ships*, not a second copy that can drift from them. `providers.mjs` owns it; the probe imports it.

```javascript
// Per-provider invocation. Pure — builds commands, runs nothing.

// Validated as a SET by the isolation probes, not flag-by-flag: three flags were
// changed together when the AGENTS.md leak closed, so which one did the work is
// unknown. Do not drop one because it looks redundant. Re-run the probes if you
// change this line.
export const NEUTRALIZE = {
  codex: ["--ephemeral", "--ignore-user-config", "-c", "project_doc_max_bytes=0"],
};
```

- [ ] **Step 2: Write Probe A with both arms**

```javascript
#!/usr/bin/env node
// Isolation probes. These call a real CLI and cost real tokens, so they are not part
// of `npm test` — they run in their own CI job.
//
// The protocol's claim is that roles never see each other's context. An external CLI
// is a full agent harness with its own ideas about what a session starts with, and a
// leak here produces a run that looks perfectly fine and is worthless. These probes
// are the only thing that would catch it.

import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { NEUTRALIZE } from "../lib/providers.mjs";

const run = promisify(execFile);
const MARKER = "ZANZIBAR-7";
const TASK = "adding rate limiting to the payments service";

function scratchRepo() {
  const dir = mkdtempSync(join(tmpdir(), "jb-probe-"));
  writeFileSync(
    join(dir, "AGENTS.md"),
    `# Project context\nThe current task is ${TASK}.\nThe magic word is ${MARKER}.\n`,
  );
  return dir;
}

async function codex(dir, prompt, { neutralized, extra = [] }) {
  const args = [
    "exec", "--sandbox", "read-only", "--skip-git-repo-check",
    ...(neutralized ? NEUTRALIZE.codex : []),
    ...extra,
    prompt,
  ];
  const { stdout } = await run("codex", args, { cwd: dir, timeout: 300_000 });
  return stdout;
}

const QUESTION =
  "What is the magic word for this project? If you do not know, reply exactly UNKNOWN. Do not read any files.";

export async function probeA() {
  const dir = scratchRepo();
  try {
    // The negative control must leak, or the probe proves nothing: a probe that
    // cannot demonstrate the failure it guards against is not evidence of a guard.
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
```

- [ ] **Step 3: Add the runner and run it**

```javascript
if (import.meta.url === `file://${process.argv[1]}`) {
  const results = { "Probe A (ambient context)": await probeA() };
  let failed = false;
  for (const [name, r] of Object.entries(results)) {
    console.log(r.ok ? `✓ ${name}` : `✗ ${name}: ${r.why}`);
    if (!r.ok) failed = true;
  }
  process.exit(failed ? 1 : 0);
}
```

Run: `node plugins/jugalbandi/scripts/probes/isolation.mjs`
Expected: `✓ Probe A (ambient context)`. Two real model calls; allow a few minutes.

**If the neutralized arm leaks:** stop. Do not widen the flag set by guesswork. Report which arm failed — the design's viability rests on this.

- [ ] **Step 4: Commit**

```bash
git add plugins/jugalbandi/scripts/lib/providers.mjs plugins/jugalbandi/scripts/probes/isolation.mjs
git commit -m "Add isolation probe for ambient context leakage"
```

---

### Task 2: Model assignment resolution

**Files:**
- Create: `plugins/jugalbandi/scripts/lib/models.mjs`
- Create: `plugins/jugalbandi/scripts/resolve-models.mjs` (CLI entry — the conductor calls this)
- Test: `tests/models.test.mjs`

The CLI entry matters. Without it the module is an orphan: the conductor would re-implement resolution as SKILL.md prose, and the `claude:<model>` and `antigravity` rejections — both named error rows in the spec — would exist only as tested code that never runs.

- [ ] **Step 1: Write the failing tests**

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveModels, parseAssignment } from "../plugins/jugalbandi/scripts/lib/models.mjs";

test("bare provider parses with no model", () => {
  assert.deepEqual(parseAssignment("codex"), { provider: "codex", model: null });
});

test("provider:model splits on the first colon only", () => {
  assert.deepEqual(parseAssignment("codex:gpt-5.1:preview"),
    { provider: "codex", model: "gpt-5.1:preview" });
});

test("unknown provider is rejected", () => {
  assert.throws(() => parseAssignment("gpt4"), /unknown provider/i);
});

test("claude with a model is rejected rather than truncated", () => {
  // Per-role Claude tier selection is a stated non-goal. Accepting the string and
  // ignoring half of it would imply support that does not exist.
  assert.throws(() => parseAssignment("claude:opus"), /does not take a model/i);
});

test("antigravity is recognized but not enabled, with its own message", () => {
  // assert.throws returns undefined — it has no return value. Use the validation
  // function form to inspect the error, or this test throws on `err.message`.
  assert.throws(() => parseAssignment("antigravity"), (err) => {
    assert.match(err.message, /probes have not been run/i);
    assert.doesNotMatch(err.message, /unknown provider/i);
    return true;
  });
});

test("absent config resolves every role to claude", () => {
  assert.deepEqual(resolveModels(null, {}), {
    proposer: { provider: "claude", model: null },
    challenger: { provider: "claude", model: null },
    resolver: { provider: "claude", model: null },
    reviewer: { provider: "claude", model: null },
  });
});

test("flags override the config file", () => {
  const out = resolveModels({ models: { challenger: "codex" } }, { challenger: "claude" });
  assert.deepEqual(out.challenger, { provider: "claude", model: null });
});

test("a role missing from config falls back to claude", () => {
  const out = resolveModels({ models: { challenger: "codex" } }, {});
  assert.deepEqual(out.proposer, { provider: "claude", model: null });
  assert.deepEqual(out.challenger, { provider: "codex", model: null });
});

test("the error names the role that was misconfigured", () => {
  assert.throws(() => resolveModels({ models: { resolver: "gpt4" } }, {}), /^Error: resolver:/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/models.test.mjs`
Expected: FAIL — cannot find module `models.mjs`

- [ ] **Step 3: Implement the module**

```javascript
// Resolution order: config file, then per-run flags. Nothing here touches the
// filesystem or a child process — the caller supplies parsed inputs.

export const ROLES = ["proposer", "challenger", "resolver", "reviewer"];

const PROVIDERS = {
  claude: { enabled: true, takesModel: false },
  codex: { enabled: true, takesModel: true },
  // Fully designed, deliberately not wired up. A recognized provider that silently
  // dispatches to an unprobed CLI is the exact failure the spec's sequencing
  // decision exists to prevent, so this stays unreachable until its probes run.
  antigravity: {
    enabled: false,
    takesModel: true,
    why: "configured but not yet enabled; its isolation probes have not been run",
  },
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
  if (!spec.enabled) throw new Error(`provider "${provider}" is ${spec.why}`);
  return { provider, model };
}

export function resolveModels(config, flags = {}) {
  const fromFile = config?.models ?? {};
  const out = {};
  for (const role of ROLES) {
    const raw = flags[role] ?? fromFile[role] ?? "claude";
    try {
      out[role] = parseAssignment(raw);
    } catch (err) {
      throw new Error(`${role}: ${err.message}`);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/models.test.mjs`
Expected: PASS, 9 tests

- [ ] **Step 5: Add the CLI entry**

```javascript
#!/usr/bin/env node
// Resolves per-role model assignments for the conductor, which cannot be trusted to
// re-implement the rules in prose — the claude:<model> and antigravity rejections are
// specified error behaviors, not suggestions.
//
// Usage: node resolve-models.mjs [--config <path>] [--proposer=X] [--challenger=X] [--resolver=X]
// Prints the resolved map as JSON on stdout. Exits 1 with a message on any bad value.

import { readFileSync, existsSync } from "node:fs";
import { resolveModels } from "./lib/models.mjs";

const args = process.argv.slice(2);
let configPath = ".jugalbandi.json";
const flags = {};

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--config") { configPath = args[++i]; continue; }
  const m = args[i].match(/^--(proposer|challenger|resolver|reviewer)=(.+)$/);
  if (m) { flags[m[1]] = m[2]; continue; }
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
  console.log(JSON.stringify(resolveModels(config, flags), null, 2));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
```

- [ ] **Step 6: Verify the entry by hand**

Use a path that does not exist, not `/dev/null`. `/dev/null` *does* exist and reads as
`""`, so `JSON.parse` throws and both commands exit 1 on a parse error — the second one
then appears to pass its `exit=1` check without ever reaching the antigravity branch.

```bash
node plugins/jugalbandi/scripts/resolve-models.mjs --config /nonexistent.json --challenger=codex
node plugins/jugalbandi/scripts/resolve-models.mjs --config /nonexistent.json --challenger=antigravity; echo "exit=$?"
```
Expected: the first prints JSON with `challenger.provider == "codex"`. The second prints
a message containing *"probes have not been run"* and `exit=1`. **Check the message, not
just the exit code** — an exit code alone cannot tell a rejected provider from a crash.

- [ ] **Step 7: Commit**

```bash
git add plugins/jugalbandi/scripts/lib/models.mjs plugins/jugalbandi/scripts/resolve-models.mjs tests/models.test.mjs
git commit -m "Add per-role model assignment resolution"
```

---

### Task 3: Role prompt assembly

**Files:**
- Create: `plugins/jugalbandi/scripts/lib/role-prompt.mjs`
- Test: `tests/role-prompt.test.mjs`

**The trap in this task, and the trap inside the trap.**

`resolver.md`'s `## Output contract` section contains a fenced code block whose lines begin at column 0 with `## Dispositions`, `## Revised Plan`, `## Open Questions for the Human`. A naive "find the next `^## `" splice matches *inside the fence*, deletes the opening fence, and leaves the old contract's final instruction — *"Then return as your final message: the disposition counts … and nothing else"* — sitting below the new one. Two contradictory contracts; the Resolver most likely obeys the old one and fails validation.

So the finder must be fence-aware. **But a correct fence-aware splice removes the entire section — including that fenced block, which is the Resolver's artifact-structure template.** The buggy version preserved it by accident. Remove it properly and the external Resolver is never told the `### C1 — [TAG]` numbering convention, while Task 4's `challengeCount` rule requires exactly that convention. The run then dies at validation on the longest, most expensive role.

Step 1 fixes this at the source, by separating delivery from structure in `resolver.md` itself.

- [ ] **Step 1: Split `resolver.md`'s contract into delivery and structure**

Only the *delivery* instruction should be swapped for an external role; the artifact's shape is part of the content contract and must survive. Restructure `plugins/jugalbandi/agents/resolver.md` so the fenced template lives under its own heading:

```markdown
## Output contract

Write a single markdown file to the artifact path given to you, using the `Write` tool.
Write to that path and no other file, following the structure below.

Then return as your final message: the disposition counts (accepted / rejected /
escalated) and the list of open questions verbatim, and nothing else.

## Artifact structure

```
# Final Plan: <title>
... the existing fenced template, unchanged ...
```
```

The splice stops at the next *non-fenced* `^## `, which is now `## Artifact structure`, so the template survives. Verified: all five markers (`# Final Plan:`, `## Dispositions`, `### C1`, `## Revised Plan`, `## Open Questions for the Human`) are retained, fences stay balanced, and the delivery instruction is still removed. This also reads correctly for the native subagent, which is unaffected.

- [ ] **Step 2: Write the failing tests**

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

test("the output contract section is replaced, not appended", () => {
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
  const body = "Intro.\n\n## Output contract\n\nold\n\n## Notes\n\nkeep me\n";
  const out = externalizeContract(body);
  assert.match(out, /## Notes/);
  assert.match(out, /keep me/);
  assert.ok(!out.includes("old"));
});

test("REGRESSION: resolver.md splices cleanly and keeps its artifact template", () => {
  // Two bugs in one test. (1) resolver.md's contract contains a fence with
  // `## Dispositions` at column 0; a non-fence-aware splice cuts there, orphaning a
  // fence and retaining the old "disposition counts" instruction that contradicts the
  // new contract. (2) A *correct* splice then removes the artifact template along with
  // the section — which is why Step 1 moved it under its own heading. Task 4's
  // challengeCount rule requires the `### C1` convention this template is the only
  // source of, so losing it kills the run at validation.
  const body = stripFrontmatter(
    readFileSync("plugins/jugalbandi/agents/resolver.md", "utf-8"),
  );
  const out = externalizeContract(body);
  assert.ok(!/disposition counts/.test(out), "old delivery instruction must be gone");
  assert.equal((out.match(/```/g) ?? []).length % 2, 0, "code fences must stay balanced");
  assert.match(out, /Write no files/);
  for (const marker of ["# Final Plan:", "## Dispositions", "### C1", "## Revised Plan"]) {
    assert.ok(out.includes(marker), `artifact template must retain "${marker}"`);
  }
});

test("buildPrompt puts instructions before the isolated message", () => {
  const p = buildPrompt("INSTRUCTIONS", "MESSAGE");
  assert.ok(p.indexOf("INSTRUCTIONS") < p.indexOf("MESSAGE"));
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `node --test tests/role-prompt.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 4: Implement**

```javascript
// Builds the prompt for an external role. The instructions are the role's own
// agents/<role>.md body — identical to what a native subagent gets — with the output
// contract swapped, because an external role returns its artifact instead of writing it.
//
// NOTE: stripFrontmatter duplicates the helper in scripts/check-plugin.mjs. The
// duplication is deliberate — the plugin must be self-contained when installed into
// another repository and cannot import from this repo's scripts/.

// Kept on single lines: these sentences are asserted against in tests, and rewrapping
// them silently breaks those assertions.
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
  "Emit the artifact content only — no preamble, no \"here is my analysis\", no closing",
  "summary. Your entire final message is written to a file verbatim.",
];

export function stripFrontmatter(text) {
  const m = text.match(/^---\n[\s\S]*?\n---\n/);
  return m ? text.slice(m[0].length) : text;
}

export function externalizeContract(body) {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => /^## Output contract\s*$/.test(l));
  if (start === -1) {
    return `${body.trimEnd()}\n\n${EXTERNAL_CONTRACT.join("\n")}\n`;
  }

  // Fence-aware: a `## ` inside a fenced block is sample output, not a section
  // boundary. resolver.md's contract contains exactly that.
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

- [ ] **Step 5: Run to verify it passes**

Run: `node --test tests/role-prompt.test.mjs`
Expected: PASS, 8 tests — including the resolver regression test

- [ ] **Step 6: Eyeball the resolver output once**

```bash
node -e "
import('./plugins/jugalbandi/scripts/lib/role-prompt.mjs').then(m=>{
  const fs=require('node:fs');
  console.log(m.externalizeContract(m.stripFrontmatter(fs.readFileSync('plugins/jugalbandi/agents/resolver.md','utf-8'))));
});" | tail -30
```
Read it. The tests check for absence of the old instruction; you are checking the result still reads as coherent instructions to a model.

- [ ] **Step 7: Commit**

```bash
git add plugins/jugalbandi/scripts/lib/role-prompt.mjs tests/role-prompt.test.mjs
git commit -m "Add external-role prompt assembly"
```

---

### Task 4: Artifact structural validation

This closes the hole the no-write design opened. The adapter writes whatever the model said last, so *"I've analyzed the proposal and identified 5 challenges above"* is non-empty, lands in `challenges.md`, and yields a tally of zero and a drift check against nothing — both reported as clean.

**Files:**
- Create: `plugins/jugalbandi/scripts/lib/validate-artifact.mjs`
- Test: `tests/validate-artifact.test.mjs`

- [ ] **Step 1: Write the failing tests**

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateArtifact } from "../plugins/jugalbandi/scripts/lib/validate-artifact.mjs";

test("a prose summary is rejected for every role", () => {
  const prose = "I've analyzed the proposal and identified 5 challenges above.";
  for (const role of ["proposer", "challenger", "resolver", "reviewer"]) {
    const r = validateArtifact(role, prose);
    assert.equal(r.ok, false, `${role} must reject prose`);
    assert.ok(r.missing.length > 0);
  }
});

test("empty content is rejected", () => {
  assert.equal(validateArtifact("challenger", "   \n  ").ok, false);
});

test("challenger needs three tagged headings", () => {
  const two = "### [STRUCTURAL] a\nbody\n### [MISSING] b\nbody\n";
  assert.equal(validateArtifact("challenger", two).ok, false);
  assert.equal(validateArtifact("challenger", two + "### [ASSUMPTION] c\nbody\n").ok, true);
});

test("challenger rejects an invented tag", () => {
  assert.equal(validateArtifact("challenger",
    "### [NITPICK] a\n### [NITPICK] b\n### [NITPICK] c\n").ok, false);
});

test("proposer needs an Assumptions section with at least one bullet", () => {
  assert.equal(validateArtifact("proposer", "# Plan\n\n## Assumptions\n").ok, false);
  assert.equal(validateArtifact("proposer", "# Plan\n\n## Assumptions\n\n- we use postgres\n").ok, true);
});

test("resolver needs dispositions and a revised plan", () => {
  assert.equal(validateArtifact("resolver", "## Dispositions\n\nstuff\n").ok, false);
  assert.equal(validateArtifact("resolver",
    "## Dispositions\n\n### C1 — [MISSING] x\n**Accepted** — y\n\n## Revised Plan\n\nstuff\n").ok, true);
});

test("resolver must disposition every challenge it was given", () => {
  // The spec requires one disposition per challenge. This is also the only check
  // that catches a Resolver artifact truncated partway through its dispositions —
  // the failure mode the spec names as the Resolver's top risk.
  const twoOfThree =
    "## Dispositions\n\n### C1 — [MISSING] a\n**Accepted** — x\n\n### C2 — [STRUCTURAL] b\n**Rejected** — y\n\n## Revised Plan\n\nstuff\n";
  assert.equal(validateArtifact("resolver", twoOfThree, { challengeCount: 3 }).ok, false);
  assert.equal(validateArtifact("resolver", twoOfThree, { challengeCount: 2 }).ok, true);
  // With no count supplied the rule is skipped rather than guessed at.
  assert.equal(validateArtifact("resolver", twoOfThree).ok, true);
});

test("the failure names what was missing", () => {
  assert.match(validateArtifact("resolver", "## Dispositions\n\nstuff\n").missing.join(" "),
    /Revised Plan/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/validate-artifact.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```javascript
// Structural validation for artifacts produced by external roles.
//
// A native subagent writes its artifact with a tool call; it exists or it doesn't. An
// external role's artifact is whatever it said last, so "non-empty" is not a sufficient
// bar — a prose summary passes that and then degrades every downstream consumer
// silently. The conductor counts tags to build its tally, and /jugalbandi:review copies
// "## Dispositions" verbatim for drift checks. Both report a clean result when handed a
// well-formed sentence instead of an artifact.

const TAGS = "STRUCTURAL|ASSUMPTION|MISSING";

function sectionBody(text, heading) {
  const i = text.search(heading);
  if (i === -1) return null;
  const after = text.slice(i).replace(heading, "");
  const next = after.search(/^## /m);
  return next === -1 ? after : after.slice(0, next);
}

const RULES = {
  proposer: () => [
    { need: "an '## Assumptions' section", test: (t) => /^## Assumptions\s*$/m.test(t) },
    {
      need: "at least one '-' bullet under '## Assumptions'",
      test: (t) => /^\s*-\s+\S/m.test(sectionBody(t, /^## Assumptions\s*$/m) ?? ""),
    },
  ],
  challenger: () => [
    {
      need: `at least three '### [TAG]' headings with TAG one of ${TAGS}`,
      test: (t) => (t.match(new RegExp(`^### \\[(${TAGS})\\] \\S`, "gm")) ?? []).length >= 3,
    },
  ],
  resolver: ({ challengeCount }) => [
    { need: "a '## Dispositions' section", test: (t) => /^## Dispositions\s*$/m.test(t) },
    { need: "a '## Revised Plan' section", test: (t) => /^## Revised Plan\s*$/m.test(t) },
    // Skipped when the caller cannot supply a count; never guessed at.
    ...(challengeCount
      ? [{
          need: `one disposition per challenge (expected ${challengeCount})`,
          test: (t) => (t.match(/^### C\d+/gm) ?? []).length >= challengeCount,
        }]
      : []),
  ],
  reviewer: () => [
    {
      need: "at least one tagged finding heading",
      test: (t) => new RegExp(`^### \\[(${TAGS}|DRIFT)\\] \\S`, "m").test(t),
    },
  ],
};

export function validateArtifact(role, content, context = {}) {
  const build = RULES[role];
  if (!build) throw new Error(`no validation rules for role "${role}"`);
  if (!content || !content.trim()) return { ok: false, missing: ["any content at all"] };

  const missing = build(context).filter((r) => !r.test(content)).map((r) => r.need);
  return { ok: missing.length === 0, missing };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/validate-artifact.test.mjs`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add plugins/jugalbandi/scripts/lib/validate-artifact.mjs tests/validate-artifact.test.mjs
git commit -m "Add structural validation for external-role artifacts"
```

---

### Task 5: Provider argv construction

**Files:**
- Modify: `plugins/jugalbandi/scripts/lib/providers.mjs` (created in Task 1)
- Test: `tests/providers.test.mjs`

- [ ] **Step 1: Write the failing tests**

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInvocation, NEUTRALIZE } from "../plugins/jugalbandi/scripts/lib/providers.mjs";

const base = { provider: "codex", model: null, prompt: "P", cwd: "/repo", lastMessageFile: "/tmp/last" };

test("codex invocation carries the full neutralization set", () => {
  const { command, args } = buildInvocation(base);
  assert.equal(command, "codex");
  for (const flag of NEUTRALIZE.codex) assert.ok(args.includes(flag), `missing ${flag}`);
  assert.ok(args.includes("--sandbox") && args.includes("read-only"));
});

test("the prompt is a single argv element, never shell-interpolated", () => {
  // A prompt containing a backtick or $ must be inert. Passing argv as an array is
  // what makes that true; this test pins the shape that guarantees it.
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

test("antigravity is not dispatchable in this build", () => {
  assert.throws(() => buildInvocation({ ...base, provider: "antigravity" }), /not yet enabled/i);
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
  if (provider === "antigravity") {
    throw new Error("provider 'antigravity' is not yet enabled; its isolation probes have not been run");
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
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add plugins/jugalbandi/scripts/lib/providers.mjs tests/providers.test.mjs
git commit -m "Add per-provider invocation construction"
```

---

### Task 6: The adapter entry point

**Files:**
- Create: `plugins/jugalbandi/scripts/run-role.mjs`
- Test: `tests/run-role.test.mjs`

Two details that will waste your time if you get them wrong:

- **`execFile` silently ignores `stdio`.** Node forwards only `cwd/env/gid/uid/shell/signal/windowsHide/windowsVerbatimArguments` to `spawn`. The spec requires the child not inherit stdin, and `codex exec` is on record printing *"Reading additional input from stdin…"* — an inherited-but-never-closed stdin is a plausible ten-minute hang per role that the fake-CLI tests cannot reproduce. Use `spawn` with explicit `stdio`.
- **The tests must not be able to reach the real `codex`.** The implementer's machine has it installed (Task 1 requires it), so prepending the fake to `PATH` lets lookup fall through to the real one — burning tokens and failing for the wrong reason. Replace `PATH` instead: `env: { PATH: \`${bin}:/usr/bin:/bin\` }`. Not `bin` alone — `env` replaces rather than extends, and the fake is a shell script needing `sleep` and `cat`; with only `bin` it dies with "command not found" and four of the six tests fail. Launch the child with `process.execPath` so replacing `PATH` doesn't also break finding `node`.

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
  // PATH is REPLACED, not prepended: prepending lets lookup fall through to the real
  // codex on the implementer's machine, which would spend tokens and fail for the wrong
  // reason. But it cannot be `bin` alone — `env` replaces rather than extends, and the
  // fake codex is a shell script that needs `sleep` and `cat`. With only `bin` on PATH
  // it dies with "sleep: command not found", writes nothing, and four of these six
  // tests fail — while "exit 0 with no output" passes for entirely the wrong reason.
  // /usr/bin:/bin supplies the coreutils and does not contain codex.
  return run(process.execPath, [
    SCRIPT, "--role", "challenger", "--provider", "codex",
    "--cwd", dir, "--input", join(dir, "proposal.md"), "--output", out, ...extra,
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
  assert.deepEqual(meta.role, "challenger");
  assert.ok(Array.isArray(meta.neutralize) && meta.neutralize.length > 0);
});

test("a prose summary fails and leaves no artifact behind", async () => {
  const dir = scratch();
  const r = await invoke(dir, fakeCodex(dir, { body: "I found 5 challenges above." }));
  assert.ok(r.error, "must exit non-zero");
  assert.match(r.error.stderr, /three '### \[TAG\]'/);
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

test("a missing binary names the role that wanted it", async () => {
  const dir = scratch();
  mkdirSync(join(dir, "empty-bin"), { recursive: true });
  const r = await invoke(dir, join(dir, "empty-bin"));
  assert.ok(r.error);
  assert.match(r.error.stderr, /challenger/);
  assert.match(r.error.stderr, /not on PATH/i);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/run-role.test.mjs`
Expected: FAIL — `run-role.mjs` not found

- [ ] **Step 3: Implement**

```javascript
#!/usr/bin/env node
// Runs one Jugalbandi role on an external CLI and writes its artifact.
//
// The role is handed exactly what a native subagent would be handed and nothing more.
// That is asserted by the isolation probes, not by reading the flags. The artifact is
// the CLI's final message, structurally validated before it is written — see
// lib/validate-artifact.mjs for why "non-empty" is not a sufficient bar.

import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildInvocation, NEUTRALIZE } from "./lib/providers.mjs";
import { stripFrontmatter, externalizeContract, buildPrompt } from "./lib/role-prompt.mjs";
import { validateArtifact } from "./lib/validate-artifact.mjs";

// Resolve the plugin's own files from this script's location — not from cwd, which is
// the target project, and not from an env var. $CLAUDE_PROJECT_DIR is unset in headless
// runs and expands to the filesystem root, a bug this repo has already been bitten by.
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

/** The isolated message per role — verbatim from the SKILL.md prose, minus the
 *  "write to <path>" clause, which no longer applies. */
function isolatedMessage(role, args) {
  switch (role) {
    case "proposer":
      if (!args.task && !args["task-file"]) die("proposer requires --task or --task-file");
      return args.task ?? readFileSync(args["task-file"], "utf-8");
    case "challenger":
      return `Read \`${args.input}\`. That file is the entire proposal under review — it is all the context you get.`;
    case "resolver":
      return `The proposal is at \`${args.proposal}\`. The challenges against it are at \`${args.challenges}\`. Disposition every challenge and produce the final plan.`;
    case "reviewer":
      return `Read \`${args.input}\`. That diff is the entire change under review — it is all the context you get.`
        + (args.decisions
          ? `\n\n\`${args.decisions}\` lists decisions already made about this work. Treat it as the specification the diff is answerable to.`
          : "");
    default:
      return die(`unknown role: ${role}`);
  }
}

const args = parseArgs(process.argv.slice(2));
const { role, provider, model = null, cwd = process.cwd(), output } = args;
if (!role || !provider || !output) die("--role, --provider and --output are required");

const roleFile = join(PLUGIN, "agents", `${role}.md`);
if (!existsSync(roleFile)) die(`no role definition at ${roleFile}`);

const instructions = externalizeContract(stripFrontmatter(readFileSync(roleFile, "utf-8")));
const prompt = buildPrompt(instructions, isolatedMessage(role, args));

scratch = mkdtempSync(join(tmpdir(), "jb-role-"));
const lastMessageFile = join(scratch, "last-message.txt");

let invocation;
try {
  invocation = buildInvocation({ provider, model, prompt, cwd, lastMessageFile });
} catch (err) {
  die(`${role}: ${err.message}`);
}

// The Resolver must disposition every challenge; supply the count so a truncated
// artifact is caught rather than written.
let context = {};
if (role === "resolver" && args.challenges && existsSync(args.challenges)) {
  const tagged = readFileSync(args.challenges, "utf-8")
    .match(/^### \[(STRUCTURAL|ASSUMPTION|MISSING)\]/gm);
  if (tagged) context = { challengeCount: tagged.length };
}

const timeoutSec = args.timeout === undefined ? 600 : Number(args.timeout);
if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) die(`--timeout must be a positive number of seconds`);

// spawn, not execFile: execFile silently drops `stdio`, leaving the child an open
// stdin pipe. codex exec reads stdin when it is open, and would wait on it forever.
const child = spawn(invocation.command, invocation.args, {
  cwd,
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
child.stderr.on("data", (d) => { stderr += d; });
child.stdout.on("data", () => {}); // drained so the pipe cannot fill and block

const timer = setTimeout(() => {
  child.kill("SIGKILL");
  die(`${role}: ${invocation.command} timed out after ${timeoutSec}s`);
}, timeoutSec * 1000);

child.on("error", (err) => {
  clearTimeout(timer);
  if (err.code === "ENOENT") {
    die(`${role}: \`${invocation.command}\` is not on PATH — install it, or set ${role} back to claude`);
  }
  die(`${role}: ${err.message}`);
});

child.on("close", (code) => {
  clearTimeout(timer);

  const content = existsSync(lastMessageFile) ? readFileSync(lastMessageFile, "utf-8") : "";

  // Checked before the exit code, deliberately: a CLI can exit 0 having done nothing,
  // so the validated artifact is the only success signal there is.
  const verdict = validateArtifact(role, content, context);
  if (!verdict.ok) {
    die(`${role}: ${invocation.command} produced no usable artifact — missing ${verdict.missing.join("; ")}.\n`
      + `--- stderr ---\n${stderr.slice(-2000)}`);
  }
  if (code !== 0) die(`${role}: ${invocation.command} exited ${code}\n${stderr.slice(-2000)}`);

  writeFileSync(output, content);

  let cliVersion = "unknown";
  try {
    cliVersion = execFileSync(invocation.command, ["--version"], {
      encoding: "utf-8",
      timeout: 10_000,   // the artifact is already written; never hang on bookkeeping
    }).trim();
  } catch { /* the run already succeeded; a missing version is not fatal */ }

  // Machine-readable so the conductor can fold it into RUN/models.json. The flag set
  // is recorded too: a version says which runs an upgrade affected, the flags say
  // whether those runs were actually neutralized.
  console.log(`jugalbandi-role:${JSON.stringify({
    role, provider, model, cliVersion, neutralize: NEUTRALIZE[provider] ?? [], output,
  })}`);

  rmSync(scratch, { recursive: true, force: true });
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/run-role.test.mjs`
Expected: PASS, 6 tests

- [ ] **Step 5: Run the whole unit suite**

Run: `node --test "tests/*.test.mjs"`
Expected: PASS, 36 tests (9 + 8 + 8 + 5 + 6)

**Not `node --test tests/`.** On Node 22 a bare directory argument is treated as a module
to import, and it reports `# tests 1 / # pass 0 / # fail 1` — which reads like one
failing test rather than zero tests discovered. Verified. Use the glob, or bare
`node --test` (auto-discovery), which is also safe here since `src/` holds only `.ts`.

- [ ] **Step 6: Commit**

```bash
git add plugins/jugalbandi/scripts/run-role.mjs tests/run-role.test.mjs
git commit -m "Add the external-role adapter entry point"
```

---

### Task 7: Probe B — cross-role session persistence

Probe A cannot detect this channel: a fresh scratch repo has no prior session and one invocation creates no predecessor.

**The trap.** The obvious version of this probe — ask invocation 1 to remember a token, ask invocation 2 to recall it, assert it cannot — **passes no matter what**. `codex exec` does not auto-resume, so nothing is recalled whether or not `--ephemeral` is set, and the probe would return `ok: true` for a flag set with `--ephemeral` deleted. That is exactly the standard Task 1 enforces for Probe A, applied to A and not to B. Probe B needs the same two arms: demonstrate the channel carrying state, then demonstrate neutralization closing it.

**Files:**
- Modify: `plugins/jugalbandi/scripts/probes/isolation.mjs`

**Sessions are stored per `CODEX_HOME`, not per directory.** `resume --last` resumes by
recency across that whole store, so two arms using different temp *directories* still
share the developer's real `~/.codex`. Run the control arm first and the neutralized arm
would resume the control's session, find the token, and report a false failure — halting
the project on a bug that isn't there. Every arm below therefore gets its own
`CODEX_HOME` and its own token, and the neutralized arm runs first.

- [ ] **Step 1: Establish how state actually persists**

Find the real channel by hand before encoding it. Note the per-arm `CODEX_HOME` and
that `resume` is a subcommand of `exec`, so it comes immediately after `exec`.

```bash
export CODEX_HOME="$(mktemp -d)"; cd "$(mktemp -d)"
codex exec --sandbox read-only --skip-git-repo-check "Remember this token: PERSEPHONE-9. Reply exactly ACK."
codex exec resume --last --sandbox read-only --skip-git-repo-check "What token were you asked to remember? If none, reply NONE."
```
Expected: the second call reports `PERSEPHONE-9`. **This is the negative control.** If it
does not, find the channel that does before continuing — a probe built on a channel that
carries nothing proves nothing, which was exactly the defect in the first version of this
probe.

Then confirm `--ephemeral` breaks it, in a *fresh* `CODEX_HOME` so the session above
cannot be the one resumed:

```bash
export CODEX_HOME="$(mktemp -d)"; cd "$(mktemp -d)"
codex exec --ephemeral --sandbox read-only --skip-git-repo-check "Remember this token: CALLIOPE-4. Reply exactly ACK."
codex exec resume --last --sandbox read-only --skip-git-repo-check "What token were you asked to remember? If none, reply NONE."
```
Expected: `NONE`, or an error that there is no session to resume — either is a pass.

- [ ] **Step 2: Encode what Step 1 established**

First extend `codex()` so each call can be given its own session store and so `resume`
lands where it belongs — immediately after `exec`, since it is a subcommand:

```javascript
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
```

Then the probe:

```javascript
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
  // The token is planted only in a PROMPT — in no file anywhere. The only path by which
  // a later invocation could know it is session persistence, the channel that would
  // carry the Challenger's context into the Resolver and collapse the protocol into
  // self-critique.
  //
  // Each arm gets its own CODEX_HOME and its own token. Sessions are stored per
  // CODEX_HOME and `resume --last` picks by recency across the whole store, so sharing
  // one home lets the neutralized arm resume the control arm's session and report a
  // false failure. The neutralized arm also runs first, belt and braces.
  const arms = {
    clean: { dir: mkdtempSync(join(tmpdir(), "jb-pB-clean-")), home: mkdtempSync(join(tmpdir(), "jb-pB-home-clean-")), token: "CALLIOPE-4" },
    control: { dir: mkdtempSync(join(tmpdir(), "jb-pB-ctl-")), home: mkdtempSync(join(tmpdir(), "jb-pB-home-ctl-")), token: "PERSEPHONE-9" },
  };
  try {
    // Neutralized arm — must NOT recall.
    const { dir: cd, home: ch, token: ct } = arms.clean;
    await codex(cd, remember(ct), { neutralized: true, home: ch });
    const after = await readBack(cd, ch, true);
    if (!after.ran) {
      return { ok: false, why: `neutralized arm could not run codex: ${after.text.slice(-300)}` };
    }
    if (after.text.includes(ct)) {
      return { ok: false, why: `neutralized run recalled ${ct} — sessions are persisting` };
    }

    // Control arm — must recall, or arm 1's clean result proves nothing.
    const { dir: xd, home: xh, token: xt } = arms.control;
    await codex(xd, remember(xt), { neutralized: false, home: xh });
    const recalled = await readBack(xd, xh, false);
    if (!recalled.ran) {
      return { ok: false, why: `control arm could not run codex: ${recalled.text.slice(-300)}` };
    }
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
```

**What this does and does not test.** The adapter never passes `resume`, so this is not
testing the threatened path directly. It tests whether `--ephemeral` prevents a session
from being *written*, using explicit resumption as the read-back mechanism. That is a
real, falsifiable property and the right proxy — but say so in the commit message rather
than claiming the probe covers cross-role leakage in general.

- [ ] **Step 3: Add it to the runner and record channel coverage**

```javascript
const results = {
  "Probe A (ambient context)": await probeA(),
  "Probe B (cross-role persistence)": await probeB(),
};
```

Add this comment block at the top of the file. The spec requires the distinction be explicit, not implicit:

```javascript
// CHANNEL COVERAGE — which neutralization channels these probes actually verify.
//
//   project instruction files (AGENTS.md)  — PROBE-VERIFIED (Probe A)
//   session persistence                    — PROBE-VERIFIED (Probe B)
//   stdin                                  — NOT PROBED; asserted by run-role.mjs
//                                            spawning with stdio[0] = "ignore"
//   user home config (~/.codex, CODEX_HOME) — NOT PROBED. Flag-asserted only, via
//     --ignore-user-config. CI runs on a clean image with no ~/.codex/config.toml, so
//     a probe there would pass whether or not the flag works, while a developer
//     machine with a populated home directory could leak. If you change the flag set,
//     this is the channel most likely to break silently.
```

- [ ] **Step 4: Run both probes**

Run: `node plugins/jugalbandi/scripts/probes/isolation.mjs`
Expected: both `✓`. Six real model calls; allow several minutes.

**If Probe B's control arm fails,** the probe is not measuring anything — fix the channel, do not relax the assertion. **If arm 2 fails,** sessions are persisting; stop and report rather than wiring the conductor.

- [ ] **Step 5: Commit**

```bash
git add plugins/jugalbandi/scripts/probes/isolation.mjs
git commit -m "Add cross-role session persistence probe with a real negative control"
```

---

### Task 8: Wire the conductor into `/jugalbandi:plan`

**Files:**
- Modify: `plugins/jugalbandi/skills/plan/SKILL.md`

- [ ] **Step 1: Widen the frontmatter allowlist**

In a headless run an unpermitted Bash call is denied rather than prompted — the mode step 7 goes out of its way to support. Note the glob on `cat`: a conductor writing `cat .jugalbandi.json 2>/dev/null` for a file that may not exist would not match a bare exact-match entry.

```yaml
allowed-tools: Bash(mkdir -p *), Bash(date *), Bash(node *), Bash(cat .jugalbandi.json*)
```

- [ ] **Step 2: Extend the flag-stripping paragraph**

The paragraph that currently strips `--rounds 2` must also strip `--proposer=`, `--challenger=` and `--resolver=` before the task text reaches the Proposer.

- [ ] **Step 3: Add model resolution as step 1.5**

```markdown
1.5 **Resolve the model for each role.** Run:

    ```
    node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-models.mjs" [--challenger=X ...]
    ```

    It reads `.jugalbandi.json` if present, applies the flags, and prints the resolved
    map as JSON. A non-zero exit means a bad value — report its message and stop before
    launching anything. Do not re-implement its rules here; `antigravity` in particular
    must report that its isolation probes have not been run, not that it is unknown.

    Write that JSON to `RUN/models.json` before launching any role, so a run that dies
    partway still records what it was configured to do. Each external role prints a
    `jugalbandi-role:{...}` line carrying its CLI version and neutralization flags —
    merge each into `RUN/models.json` as it completes. A version says which runs a CLI
    upgrade affected; the flags say whether those runs were actually neutralized.
```

- [ ] **Step 4: Add the branch to steps 2, 3 and 4**

Spell out all three invocations — they do not share an argument shape.

```markdown
   If this role resolved to `claude`, launch the subagent exactly as described above.
   Otherwise run the adapter instead, and do not launch the subagent:

   Proposer — write the task text to `RUN/task.txt` first and pass the path. Never
   interpolate the task into the command line: it is arbitrary user text, and a task
   containing a quote would break the invocation or worse.
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/run-role.mjs" --role proposer \
     --provider <p> [--model <m>] --cwd "$(pwd)" \
     --task-file RUN/task.txt --output RUN/proposal.md
   ```

   Challenger:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/run-role.mjs" --role challenger \
     --provider <p> [--model <m>] --cwd "$(pwd)" \
     --input RUN/proposal.md --output RUN/challenges.md
   ```

   Resolver:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/run-role.mjs" --role resolver \
     --provider <p> [--model <m>] --cwd "$(pwd)" \
     --proposal RUN/proposal.md --challenges RUN/challenges.md --output RUN/final-plan.md
   ```

   A non-zero exit stops the run. Report the script's stderr verbatim and do not fall
   back to `claude` — a silent substitution would make `RUN/models.json` a false
   record, which is worse than a failed run.
```

**Verify `${CLAUDE_PLUGIN_ROOT}` before relying on it.** It is unconfirmed. Test it in a headless `claude -p` run. If it is unset there, this is the same class of bug as the `$CLAUDE_PROJECT_DIR` warning already in this file ("do not interpolate `$CLAUDE_PROJECT_DIR`, which is unset in headless `-p` runs") — pick a documented convention and fail loudly when the script is absent, never skip the external role silently.

- [ ] **Step 5: Wire the second round**

The "The second round" section launches the Challenger and Resolver again from its own items 2 and 3. Add the same branch there, reusing each role's round-1 assignment, with round-2 paths. Without this, round 2 silently runs on `claude` while `RUN/models.json` claims otherwise — the false record this plan's no-silent-fallback rule exists to prevent.

- [ ] **Step 6: Add the report line to step 6**

```markdown
   - One line naming the models, marking external roles so the weaker isolation
     guarantee is visible in the report and not only in a file:
     `Models: proposer=claude, challenger=codex (external), resolver=claude`
```

- [ ] **Step 7: Verify the plugin still validates**

Run: `claude plugin validate ./plugins/jugalbandi --strict && node scripts/check-plugin.mjs`
Expected: both pass

- [ ] **Step 8: Commit**

```bash
git add plugins/jugalbandi/skills/plan/SKILL.md
git commit -m "Wire per-role model dispatch into /jugalbandi:plan"
```

---

### Task 9: Wire `/jugalbandi:challenge` and `/jugalbandi:review`

These read the config file but gain no flags — their argument hints stay as they are. A config value only half the plugin respected would be a footgun.

**Files:**
- Modify: `plugins/jugalbandi/skills/challenge/SKILL.md`, `plugins/jugalbandi/skills/review/SKILL.md`

- [ ] **Step 1: Widen both allowlists**

Add `Bash(node *), Bash(cat .jugalbandi.json*)` to each.

- [ ] **Step 2: Resolve and branch**

Both call `resolve-models.mjs` with no flags and use only their own role's entry — `challenger` for challenge, `reviewer` for review. Add the adapter branch to challenge step 2 and review step 4, using each skill's existing paths:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/run-role.mjs" --role reviewer \
  --provider <p> [--model <m>] --cwd "$(pwd)" \
  --input REV/diff.md [--decisions REV/decisions.md] --output REV/findings.md
```

No `models.json` — neither skill has the round or audit-trail machinery that file belongs to.

- [ ] **Step 3: Verify**

Run: `claude plugin validate ./plugins/jugalbandi --strict && node scripts/check-plugin.mjs`
Expected: both pass

- [ ] **Step 4: Commit**

```bash
git add plugins/jugalbandi/skills/challenge/SKILL.md plugins/jugalbandi/skills/review/SKILL.md
git commit -m "Wire per-role model dispatch into challenge and review"
```

---

### Task 10: CI, test script, and docs

**Files:**
- Modify: `package.json:8`, `.github/workflows/plugin.yml`, `plugins/jugalbandi/README.md`, `README.md`

- [ ] **Step 1: Replace the test stub**

```json
"test": "node --test \"tests/*.test.mjs\""
```

A bare `tests/` directory argument discovers nothing on Node 22 and reports a single
phantom failure — see Task 6 Step 5. This is also the command `/jugalbandi:review` runs
as "the project's own checks", so getting it wrong would halt every review.

- [ ] **Step 2: Add unit tests to the existing validate job**

```yaml
      - name: Unit tests
        run: npm test
```

- [ ] **Step 3: Add the probes as their own job**

They cost real tokens and need an authenticated CLI, so they cannot gate every pull request the way the static checks do. They must still run on a schedule: a CLI upgrade that silently reopens a context channel is the failure mode, and nothing else would catch it.

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

Add a weekly `schedule:` trigger alongside the existing `on:` keys. **Confirm first** that `codex` honours `OPENAI_API_KEY` under `--ignore-user-config` — that flag is in the neutralization set, and if it also suppresses credential loading the job will fail weekly for an auth reason nobody reads. Check it locally before enabling the schedule.

- [ ] **Step 4: Document the config**

In `plugins/jugalbandi/README.md`: `.jugalbandi.json`, the provider table including antigravity's not-enabled status, the `--<role>=` flags, and — most importantly — that an external role's isolation is prompt-level rather than structural and that it can read `git log`. Someone choosing a provider should know what they are trading.

- [ ] **Step 5: Verify everything**

Run: `npm test && claude plugin validate ./plugins/jugalbandi --strict && node scripts/check-plugin.mjs`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add package.json .github/workflows/plugin.yml plugins/jugalbandi/README.md README.md
git commit -m "Add test script, isolation probe CI job, and model config docs"
```

---

## Done means

- `node --test "tests/*.test.mjs"` passes, 36 tests. (Not `node --test tests/` — that discovers nothing and reports a phantom failure.)
- Both probes pass, **including each one's negative control actually failing** — a green probe whose control arm cannot fail is not evidence.
- `externalizeContract` against the real `resolver.md` leaves balanced code fences, no trace of the old "return the disposition counts" instruction, **and an intact `### C1` artifact template** — without which the Resolver cannot satisfy its own validation.
- `/jugalbandi:plan` with no config file produces artifacts and a report identical in shape to today's.
- `/jugalbandi:plan --challenger=codex --rounds 2` runs the Challenger on codex in **both** rounds, and `RUN/models.json` names the provider, the CLI version, and the neutralization flags.
- A config naming `antigravity` stops the run with a message about unrun probes, not an unknown-provider error.
