# Per-Role Model Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each Jugalbandi role run on a different provider, with the protocol's context-isolation guarantee proven by test rather than assumed.

**Architecture:** A dependency-free Node script inside the plugin (`run-role.mjs`) builds a role's prompt from its existing `agents/<role>.md`, runs it through an external CLI with ambient context neutralized, captures the CLI's final message as the artifact, and validates that artifact's structure before anyone reads it. The three SKILL.md conductors branch per role: `claude` launches the native subagent as today, anything else shells out to the script. Pure logic lives in small `lib/` modules that are unit-testable without invoking a model; only the probes call a real CLI.

**Tech Stack:** Node 22 ESM, no npm dependencies (matching `scripts/check-plugin.mjs`), `node --test` as the runner, `codex` CLI as the only enabled external provider.

**Spec:** `docs/superpowers/specs/2026-09-12-plugin-model-config-design.md`

---

## Critical context for the implementer

You are building plumbing for a protocol whose entire claim is that three roles never see each other's context. If that isolation breaks, **nothing in the output looks wrong** — the run produces a plan, a tally, and artifacts, and is silently worthless. This is why Task 1 comes first and why it is not optional.

Three findings were measured before this plan was written. Do not re-derive them; do not assume they are still true after a CLI upgrade either — that is what the probes are for.

1. `codex exec --sandbox read-only`, in a repo containing an `AGENTS.md`, answered a question about the file's contents *while being told not to read files*. The file is preloaded into context before the prompt arrives.
2. Adding `--ephemeral --ignore-user-config -c project_doc_max_bytes=0` closed it — same repo, same question, answer `UNKNOWN`. **Note:** three flags changed at once, so what is known is that the *set* works, not which member did the work. Task 1 encodes the set.
3. `codex exec --sandbox read-only` will still run `git log` and report the result. Read-only blocks writes, not execution. This is an accepted divergence, documented in the spec — do not try to "fix" it.

## File structure

**Create:**
- `plugins/jugalbandi/scripts/run-role.mjs` — CLI entry; spawn, timeout, capture, write
- `plugins/jugalbandi/scripts/lib/providers.mjs` — per-provider argv and capture strategy
- `plugins/jugalbandi/scripts/lib/resolve-models.mjs` — config + flag resolution, provider status
- `plugins/jugalbandi/scripts/lib/role-prompt.mjs` — frontmatter strip, output-contract substitution
- `plugins/jugalbandi/scripts/lib/validate-artifact.mjs` — per-role structural validation
- `plugins/jugalbandi/scripts/probes/isolation.mjs` — Probes A and B; calls a real CLI
- `tests/resolve-models.test.mjs`, `tests/role-prompt.test.mjs`, `tests/validate-artifact.test.mjs`, `tests/providers.test.mjs`, `tests/run-role.test.mjs`

**Modify:**
- `plugins/jugalbandi/skills/plan/SKILL.md` — branch per role, flags, `models.json`, report line
- `plugins/jugalbandi/skills/challenge/SKILL.md`, `plugins/jugalbandi/skills/review/SKILL.md` — branch per role
- `package.json:8` — replace the `test` stub
- `.github/workflows/plugin.yml` — run unit tests; probes in a separate job
- `plugins/jugalbandi/README.md`, `README.md` — document the config file

`lib/` modules are pure and import nothing but `node:` builtins. Everything that talks to a child process lives in `run-role.mjs`. That split is what makes most of this testable without burning model calls.

**Why duplicate `frontmatter()` from `scripts/check-plugin.mjs`:** the plugin directory must be self-contained when installed into another repo. It cannot import from repo-root `scripts/`. Copy the function; note the duplication in a comment.

---

### Task 1: Lock the neutralization flag set as an executable probe

Do this first. If it fails, stop and report — every later task is built on it.

**Files:**
- Create: `plugins/jugalbandi/scripts/probes/isolation.mjs`

- [ ] **Step 1: Write Probe A with both arms**

```javascript
#!/usr/bin/env node
// Isolation probes. These call a real CLI and cost real tokens, so they are not
// part of `npm test` — they run in their own CI job.
//
// The protocol's claim is that roles never see each other's context. An external
// CLI is a full agent harness with its own ideas about what a session starts with,
// and a leak here produces a run that looks perfectly fine and is worthless. These
// probes are the only thing that would catch that.

import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const MARKER = "ZANZIBAR-7";
const TASK = "adding rate limiting to the payments service";

// The flag set under test. Measured to close the AGENTS.md channel; three flags
// changed together, so this is validated as a set, not flag-by-flag.
export const NEUTRALIZE = [
  "--ephemeral",
  "--ignore-user-config",
  "-c", "project_doc_max_bytes=0",
];

function scratchRepo() {
  const dir = mkdtempSync(join(tmpdir(), "jb-probe-"));
  writeFileSync(
    join(dir, "AGENTS.md"),
    `# Project context\nThe current task is ${TASK}.\nThe magic word is ${MARKER}.\n`,
  );
  return dir;
}

async function askCodex(dir, prompt, { neutralized }) {
  const args = [
    "exec", "--sandbox", "read-only", "--skip-git-repo-check",
    ...(neutralized ? NEUTRALIZE : []),
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
    const leaked = await askCodex(dir, QUESTION, { neutralized: false });
    if (!leaked.includes(MARKER)) {
      // The negative control must fail, or the probe proves nothing: a probe that
      // cannot demonstrate the leak it guards against is not evidence of a guard.
      return { ok: false, why: "negative control did not leak — probe is not measuring anything" };
    }
    const clean = await askCodex(dir, QUESTION, { neutralized: true });
    if (clean.includes(MARKER)) {
      return { ok: false, why: `neutralized run leaked ${MARKER}` };
    }
    return { ok: true };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 2: Add a runner and run it**

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
Expected: `✓ Probe A (ambient context)`. Takes a few minutes — two real model calls.

**If the neutralized arm leaks:** stop. Do not proceed, do not widen the flag set by guesswork. Report which arm failed. The design's viability rests on this.

- [ ] **Step 3: Commit**

```bash
git add plugins/jugalbandi/scripts/probes/isolation.mjs
git commit -m "Add isolation probe for ambient context leakage"
```

---

### Task 2: Model assignment resolution

**Files:**
- Create: `plugins/jugalbandi/scripts/lib/resolve-models.mjs`
- Test: `tests/resolve-models.test.mjs`

- [ ] **Step 1: Write the failing tests**

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveModels, parseAssignment } from "../plugins/jugalbandi/scripts/lib/resolve-models.mjs";

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
  assert.throws(() => parseAssignment("antigravity"), /probes have not been run/i);
  assert.doesNotThrow(() => { try { parseAssignment("antigravity"); } catch (e) {
    assert.ok(!/unknown provider/i.test(e.message), "must not be the generic unknown error");
    throw e;
  }});
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
  const cfg = { models: { challenger: "codex" } };
  const out = resolveModels(cfg, { challenger: "claude" });
  assert.deepEqual(out.challenger, { provider: "claude", model: null });
});

test("a role missing from config falls back to claude", () => {
  const out = resolveModels({ models: { challenger: "codex" } }, {});
  assert.deepEqual(out.proposer, { provider: "claude", model: null });
  assert.deepEqual(out.challenger, { provider: "codex", model: null });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/resolve-models.test.mjs`
Expected: FAIL — cannot find module `resolve-models.mjs`

- [ ] **Step 3: Implement**

```javascript
// Resolution order: config file, then per-run flags. Nothing here touches the
// filesystem or a child process — the caller supplies parsed inputs.

export const ROLES = ["proposer", "challenger", "resolver", "reviewer"];

const PROVIDERS = {
  claude: { enabled: true, takesModel: false },
  codex: { enabled: true, takesModel: true },
  // Fully designed, deliberately not wired up. A recognized provider that
  // silently dispatches to an unprobed CLI is the exact failure the sequencing
  // decision exists to prevent, so this must stay unreachable until its probes run.
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
    throw new Error(
      `unknown provider "${provider}" — expected one of ${Object.keys(PROVIDERS).join(", ")}`,
    );
  }
  if (model && !spec.takesModel) {
    throw new Error(`provider "${provider}" does not take a model (got "${value}")`);
  }
  if (!spec.enabled) {
    throw new Error(`provider "${provider}" is ${spec.why}`);
  }
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

Run: `node --test tests/resolve-models.test.mjs`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add plugins/jugalbandi/scripts/lib/resolve-models.mjs tests/resolve-models.test.mjs
git commit -m "Add per-role model assignment resolution"
```

---

### Task 3: Role prompt assembly

The external role gets the same instructions a native subagent gets, with one section swapped: it returns the artifact instead of writing it.

**Files:**
- Create: `plugins/jugalbandi/scripts/lib/role-prompt.mjs`
- Test: `tests/role-prompt.test.mjs`

- [ ] **Step 1: Write the failing tests**

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
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
  assert.ok(/final message/i.test(out), "new contract must be present");
  assert.equal(out.match(/## Output contract/g).length, 1, "exactly one contract section");
});

test("the external contract forbids writing and VCS inspection", () => {
  const out = externalizeContract("x\n\n## Output contract\n\nold\n");
  assert.match(out, /write no files/i);
  assert.match(out, /git log/i);
});

test("a body with no contract section still gets one", () => {
  // Guards against a role file being edited to drop the heading — the external
  // role would otherwise be told nothing about how to return its work.
  const out = externalizeContract("Just instructions.\n");
  assert.match(out, /## Output contract/);
});

test("buildPrompt joins instructions and the isolated message", () => {
  const p = buildPrompt("INSTRUCTIONS", "MESSAGE");
  assert.ok(p.indexOf("INSTRUCTIONS") < p.indexOf("MESSAGE"));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/role-prompt.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```javascript
// Builds the prompt for an external role. The instructions are the role's own
// agents/<role>.md body — identical to what the native subagent gets — with the
// output contract swapped, because an external role returns its artifact instead
// of writing it.
//
// NOTE: stripFrontmatter duplicates the helper in scripts/check-plugin.mjs. The
// duplication is deliberate: the plugin must be self-contained when installed
// into another repository and cannot import from this repo's scripts/.

const EXTERNAL_CONTRACT = `## Output contract

Return the complete artifact as your final message, and nothing else. Write no
files — the caller captures your final message and writes it. Do not call any
file-writing tool.

Do not inspect version control. Do not run \`git log\`, \`git diff\`, \`git show\`,
or \`git reflog\`. What you were given is the whole context you get; reconstructing
more from repository history defeats the purpose of this role.

Emit the artifact content only — no preamble, no "here is my analysis", no closing
summary. Your entire final message is written to a file verbatim.`;

export function stripFrontmatter(text) {
  const m = text.match(/^---\n[\s\S]*?\n---\n/);
  return m ? text.slice(m[0].length) : text;
}

export function externalizeContract(body) {
  const heading = /^## Output contract\s*$/m;
  if (!heading.test(body)) return `${body.trimEnd()}\n\n${EXTERNAL_CONTRACT}\n`;

  const start = body.search(heading);
  const after = body.slice(start).replace(heading, "");
  const nextHeading = after.search(/^## /m);
  const tail = nextHeading === -1 ? "" : after.slice(nextHeading);
  return `${body.slice(0, start)}${EXTERNAL_CONTRACT}\n\n${tail}`.trimEnd() + "\n";
}

export function buildPrompt(instructions, isolatedMessage) {
  return `${instructions.trimEnd()}\n\n---\n\n${isolatedMessage.trim()}\n`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/role-prompt.test.mjs`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add plugins/jugalbandi/scripts/lib/role-prompt.mjs tests/role-prompt.test.mjs
git commit -m "Add external-role prompt assembly"
```

---

### Task 4: Artifact structural validation

This is the task that closes the hole the no-write design opened. Read it carefully.

The adapter writes whatever the model said last. A final message reading *"I've analyzed the proposal and identified 5 challenges above"* is non-empty and would land in `challenges.md`, where the conductor counts zero tags and `/jugalbandi:review` copies zero dispositions — both reported as clean results.

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
  const three = two + "### [ASSUMPTION] c\nbody\n";
  assert.equal(validateArtifact("challenger", three).ok, true);
});

test("challenger rejects an invented tag", () => {
  const bad = "### [NITPICK] a\n### [NITPICK] b\n### [NITPICK] c\n";
  assert.equal(validateArtifact("challenger", bad).ok, false);
});

test("proposer needs an Assumptions section with at least one bullet", () => {
  assert.equal(validateArtifact("proposer", "# Plan\n\n## Assumptions\n").ok, false);
  assert.equal(validateArtifact("proposer", "# Plan\n\n## Assumptions\n\n- we use postgres\n").ok, true);
});

test("resolver needs dispositions and a revised plan", () => {
  assert.equal(validateArtifact("resolver", "## Dispositions\n\nstuff\n").ok, false);
  assert.equal(
    validateArtifact("resolver", "## Dispositions\n\nstuff\n\n## Revised Plan\n\nstuff\n").ok,
    true,
  );
});

test("the failure names what was missing", () => {
  const r = validateArtifact("resolver", "## Dispositions\n\nstuff\n");
  assert.match(r.missing.join(" "), /Revised Plan/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/validate-artifact.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```javascript
// Structural validation for artifacts produced by external roles.
//
// A native subagent writes its artifact with a tool call; it exists or it doesn't.
// An external role's artifact is whatever it said last, so "non-empty" is not a
// sufficient bar — a prose summary passes that and then degrades every downstream
// consumer silently. The conductor counts tags to build its tally, and
// /jugalbandi:review copies "## Dispositions" verbatim for drift checks. Both
// report a clean result when handed a well-formed sentence instead of an artifact.

const TAGS = "STRUCTURAL|ASSUMPTION|MISSING";

const RULES = {
  proposer: [
    { need: "an '## Assumptions' section", test: (t) => /^## Assumptions\s*$/m.test(t) },
    {
      need: "at least one '-' bullet under '## Assumptions'",
      test: (t) => {
        const i = t.search(/^## Assumptions\s*$/m);
        if (i === -1) return false;
        const after = t.slice(i).replace(/^## Assumptions\s*$/m, "");
        const next = after.search(/^## /m);
        return /^\s*-\s+\S/m.test(next === -1 ? after : after.slice(0, next));
      },
    },
  ],
  challenger: [
    {
      need: `at least three '### [TAG]' headings with TAG one of ${TAGS}`,
      test: (t) => (t.match(new RegExp(`^### \\[(${TAGS})\\] \\S`, "gm")) ?? []).length >= 3,
    },
  ],
  resolver: [
    { need: "a '## Dispositions' section", test: (t) => /^## Dispositions\s*$/m.test(t) },
    { need: "a '## Revised Plan' section", test: (t) => /^## Revised Plan\s*$/m.test(t) },
  ],
  reviewer: [
    {
      need: "at least one tagged finding heading",
      test: (t) => new RegExp(`^### \\[(${TAGS}|DRIFT)\\] \\S`, "m").test(t),
    },
  ],
};

export function validateArtifact(role, content) {
  const rules = RULES[role];
  if (!rules) throw new Error(`no validation rules for role "${role}"`);
  if (!content || !content.trim()) return { ok: false, missing: ["any content at all"] };

  const missing = rules.filter((r) => !r.test(content)).map((r) => r.need);
  return { ok: missing.length === 0, missing };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/validate-artifact.test.mjs`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add plugins/jugalbandi/scripts/lib/validate-artifact.mjs tests/validate-artifact.test.mjs
git commit -m "Add structural validation for external-role artifacts"
```

---

### Task 5: Provider argv construction

**Files:**
- Create: `plugins/jugalbandi/scripts/lib/providers.mjs`
- Test: `tests/providers.test.mjs`

- [ ] **Step 1: Write the failing tests**

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInvocation, NEUTRALIZE } from "../plugins/jugalbandi/scripts/lib/providers.mjs";

test("codex invocation carries the full neutralization set", () => {
  const { command, args } = buildInvocation({
    provider: "codex", model: null, prompt: "P", cwd: "/repo", lastMessageFile: "/tmp/last",
  });
  assert.equal(command, "codex");
  for (const flag of NEUTRALIZE.codex) assert.ok(args.includes(flag), `missing ${flag}`);
  assert.ok(args.includes("--sandbox") && args.includes("read-only"));
});

test("the prompt is a single argv element, never shell-interpolated", () => {
  // A prompt containing a backtick or $ must be inert. execFile with an argv array
  // is what makes that true; this test pins the shape that guarantees it.
  const nasty = "`rm -rf /` $(whoami)";
  const { args } = buildInvocation({
    provider: "codex", model: null, prompt: nasty, cwd: "/repo", lastMessageFile: "/tmp/l",
  });
  assert.ok(args.includes(nasty), "prompt must appear as one intact element");
});

test("a model is passed only when specified", () => {
  const without = buildInvocation({ provider: "codex", model: null, prompt: "P", cwd: "/r", lastMessageFile: "/l" });
  assert.ok(!without.args.includes("-m"));
  const with_ = buildInvocation({ provider: "codex", model: "gpt-5.1-codex", prompt: "P", cwd: "/r", lastMessageFile: "/l" });
  assert.deepEqual(
    with_.args.slice(with_.args.indexOf("-m"), with_.args.indexOf("-m") + 2),
    ["-m", "gpt-5.1-codex"],
  );
});

test("claude has no invocation — it never goes through the adapter", () => {
  assert.throws(() => buildInvocation({ provider: "claude", prompt: "P", cwd: "/r" }), /native subagent/i);
});

test("antigravity is not dispatchable in this build", () => {
  assert.throws(() => buildInvocation({ provider: "antigravity", prompt: "P", cwd: "/r" }), /not yet enabled/i);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/providers.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```javascript
// Per-provider argv. Pure — builds the command, runs nothing.
//
// The neutralization set is validated as a SET by the isolation probes, not
// flag-by-flag: three flags were changed together when the AGENTS.md leak closed.
// Do not drop one because it looks redundant; re-run the probes if you change it.

export const NEUTRALIZE = {
  codex: ["--ephemeral", "--ignore-user-config", "-c", "project_doc_max_bytes=0"],
};

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

The tests use a fake CLI on `PATH` — a shell script that writes a canned final message — so the adapter's spawn/timeout/capture/validate path is exercised without a model call.

- [ ] **Step 1: Write the failing tests**

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const SCRIPT = resolve("plugins/jugalbandi/scripts/run-role.mjs");

/** A stand-in `codex` that writes `body` to the file given after -o. */
function fakeCodex(dir, { body, exitCode = 0, sleep = 0 }) {
  const bin = join(dir, "bin");
  writeFileSync(join(dir, "payload.txt"), body ?? "");
  const script = `#!/bin/sh
sleep ${sleep}
out=""
while [ $# -gt 0 ]; do
  case "$1" in -o) out="$2"; shift 2;; *) shift;; esac
done
[ -n "$out" ] && cat "${join(dir, "payload.txt")}" > "$out"
exit ${exitCode}
`;
  require("node:fs").mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "codex"), script);
  chmodSync(join(bin, "codex"), 0o755);
  return bin;
}

async function invoke(dir, bin, extra = []) {
  const out = join(dir, "challenges.md");
  return run("node", [
    SCRIPT, "--role", "challenger", "--provider", "codex",
    "--cwd", dir, "--input", join(dir, "proposal.md"), "--output", out, ...extra,
  ], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } })
    .then((r) => ({ ...r, out }))
    .catch((e) => ({ error: e, out }));
}

test("a well-formed artifact is written", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jb-"));
  writeFileSync(join(dir, "proposal.md"), "a proposal");
  const body = "### [STRUCTURAL] a\nx\n### [MISSING] b\nx\n### [ASSUMPTION] c\nx\n";
  const r = await invoke(dir, fakeCodex(dir, { body }));
  assert.ok(!r.error, r.error?.stderr);
  assert.equal(readFileSync(r.out, "utf-8"), body);
});

test("a prose summary fails and writes no artifact", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jb-"));
  writeFileSync(join(dir, "proposal.md"), "a proposal");
  const r = await invoke(dir, fakeCodex(dir, { body: "I found 5 challenges above." }));
  assert.ok(r.error, "must exit non-zero");
  assert.match(r.error.stderr, /three '### \[TAG\]'/);
  assert.ok(!existsSync(r.out), "must not leave a half-valid artifact behind");
});

test("exit code 0 with no output is still a failure", async () => {
  // Measured: gemini exits 0 on an auth failure having done nothing. The written
  // artifact is the only success signal; the exit code is not.
  const dir = mkdtempSync(join(tmpdir(), "jb-"));
  writeFileSync(join(dir, "proposal.md"), "a proposal");
  const r = await invoke(dir, fakeCodex(dir, { body: "", exitCode: 0 }));
  assert.ok(r.error, "must exit non-zero");
});

test("a timeout kills the child", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jb-"));
  writeFileSync(join(dir, "proposal.md"), "a proposal");
  const r = await invoke(dir, fakeCodex(dir, { body: "x", sleep: 5 }), ["--timeout", "1"]);
  assert.ok(r.error);
  assert.match(r.error.stderr, /timed out/i);
});

test("a missing binary names the role that wanted it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jb-"));
  writeFileSync(join(dir, "proposal.md"), "a proposal");
  const r = await invoke(dir, join(dir, "empty-bin"));
  assert.ok(r.error);
  assert.match(r.error.stderr, /challenger/);
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
// The role is handed exactly what a native subagent would be handed and nothing
// more; see the isolation probes for why that is asserted by test rather than by
// reading the flags. The artifact is the CLI's final message, structurally
// validated before it is written — see lib/validate-artifact.mjs.

import { execFile } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildInvocation } from "./lib/providers.mjs";
import { stripFrontmatter, externalizeContract, buildPrompt } from "./lib/role-prompt.mjs";
import { validateArtifact } from "./lib/validate-artifact.mjs";

// Resolve the plugin's own files from this script's location. Not from cwd, which
// is the target project, and not from an env var — $CLAUDE_PROJECT_DIR is unset in
// headless runs and expands to the filesystem root, a bug this repo has already
// been bitten by (see plan/SKILL.md).
const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const die = (msg) => { console.error(msg); process.exit(1); };

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith("--")) die(`unexpected argument: ${argv[i]}`);
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}

/** The isolated message for each role — verbatim from the SKILL.md prose, minus
 *  the "write to <path>" clause, which no longer applies. */
function isolatedMessage(role, args) {
  switch (role) {
    case "proposer":
      return args.task;
    case "challenger":
      return `Read \`${args.input}\`. That file is the entire proposal under review — it is all the context you get.`;
    case "resolver":
      return `The proposal is at \`${args.proposal}\`. The challenges against it are at \`${args.challenges}\`. Disposition every challenge and produce the final plan.`;
    case "reviewer":
      return `Read \`${args.input}\`. That diff is the entire change under review — it is all the context you get.`
        + (args.decisions ? `\n\n\`${args.decisions}\` lists decisions already made about this work. Treat it as the specification the diff is answerable to.` : "");
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

const scratch = mkdtempSync(join(tmpdir(), "jb-role-"));
const lastMessageFile = join(scratch, "last-message.txt");

let invocation;
try {
  invocation = buildInvocation({ provider, model, prompt, cwd, lastMessageFile });
} catch (err) {
  die(`${role}: ${err.message}`);
}

const timeoutMs = (Number(args.timeout) || 600) * 1000;

execFile(
  invocation.command,
  invocation.args,
  { cwd, timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 },
  (err, stdout, stderr) => {
    try {
      if (err?.code === "ENOENT") {
        die(`${role}: \`${invocation.command}\` is not on PATH — install it or set ${role} back to claude`);
      }
      if (err?.killed) die(`${role}: ${invocation.command} timed out after ${timeoutMs / 1000}s`);

      const content = existsSync(lastMessageFile)
        ? readFileSync(lastMessageFile, "utf-8")
        : "";

      // Deliberately checked before the exit code: a CLI can exit 0 having done
      // nothing at all, so the artifact is the only success signal there is.
      const verdict = validateArtifact(role, content);
      if (!verdict.ok) {
        die(
          `${role}: ${invocation.command} did not produce a usable artifact — missing ${verdict.missing.join("; ")}.\n`
          + `--- stderr ---\n${(stderr || "").slice(-2000)}`,
        );
      }
      if (err) die(`${role}: ${invocation.command} failed (${err.code})\n${(stderr || "").slice(-2000)}`);

      writeFileSync(output, content);
      console.log(`${role}: wrote ${output} (${provider}${model ? `:${model}` : ""})`);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  },
);
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/run-role.test.mjs`
Expected: PASS, 5 tests

- [ ] **Step 5: Run the whole unit suite**

Run: `node --test tests/`
Expected: PASS, 30 tests

- [ ] **Step 6: Commit**

```bash
git add plugins/jugalbandi/scripts/run-role.mjs tests/run-role.test.mjs
git commit -m "Add the external-role adapter entry point"
```

---

### Task 7: Probe B — cross-role leakage

Probe A cannot detect this. A fresh scratch repo has no prior session and one invocation creates no predecessor, so an implementer who neutralizes instruction files but drops `--ephemeral` passes Probe A cleanly and ships the leak this whole design exists to prevent.

**Files:**
- Modify: `plugins/jugalbandi/scripts/probes/isolation.mjs`

- [ ] **Step 1: Add Probe B**

```javascript
const SECRET = "PERSEPHONE-9";

export async function probeB() {
  // The marker is planted only in role 1's PROMPT — in no file anywhere. The only
  // path by which role 2 could know it is session persistence between invocations,
  // which is exactly the channel that would carry the Challenger's context into
  // the Resolver and collapse the protocol into self-critique.
  const dir = scratchRepo();
  try {
    await askCodex(dir, `Remember this token for later: ${SECRET}. Reply exactly ACK.`, { neutralized: true });
    const second = await askCodex(
      dir,
      "What token were you asked to remember? If you were not asked to remember one, reply exactly NONE.",
      { neutralized: true },
    );
    if (second.includes(SECRET)) {
      return { ok: false, why: `second invocation recalled ${SECRET} — sessions are persisting` };
    }
    return { ok: true };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 2: Add it to the runner**

```javascript
const results = {
  "Probe A (ambient context)": await probeA(),
  "Probe B (cross-role persistence)": await probeB(),
};
```

- [ ] **Step 3: Run both probes**

Run: `node plugins/jugalbandi/scripts/probes/isolation.mjs`
Expected: both `✓`. Four real model calls; allow several minutes.

**If Probe B fails:** the session is persisting across invocations. Stop and report — do not proceed to wiring. A leak here is invisible in every artifact the protocol produces.

- [ ] **Step 4: Commit**

```bash
git add plugins/jugalbandi/scripts/probes/isolation.mjs
git commit -m "Add cross-role session persistence probe"
```

---

### Task 8: Wire the conductor into `/jugalbandi:plan`

**Files:**
- Modify: `plugins/jugalbandi/skills/plan/SKILL.md`

- [ ] **Step 1: Widen the frontmatter allowlist**

In a headless run an unpermitted Bash call is denied rather than prompted — the exact mode step 7 goes out of its way to support.

```yaml
allowed-tools: Bash(mkdir -p *), Bash(date *), Bash(node *), Bash(cat .jugalbandi.json)
```

- [ ] **Step 2: Add flag parsing to the `--rounds` paragraph**

Extend the existing paragraph that strips `--rounds 2` so it also strips `--proposer=`, `--challenger=`, and `--resolver=` before the task text reaches the Proposer.

- [ ] **Step 3: Add model resolution as step 1.5**

```markdown
1.5 **Resolve the model for each role.** Read `.jugalbandi.json` at the project root
    if it exists; take `models.<role>` for each of proposer, challenger and resolver,
    defaulting to `claude`. Apply any `--<role>=` flag from this invocation on top.

    Reject an unknown provider, `claude:<model>`, or `antigravity` here and stop —
    before launching anything. `antigravity` is recognized but not enabled; say that
    its isolation probes have not been run rather than reporting it as unknown.

    Write the resolved map to `RUN/models.json` before launching any role, so a run
    that dies partway still records what it was configured to do. After each external
    role, append the CLI version it ran on and the neutralization flags it was given:
    the leak this guards against is version-dependent, and an audit trail without
    versions cannot be re-examined after an upgrade.
```

- [ ] **Step 4: Add the branch to steps 2, 3 and 4**

Each role step gains the same paragraph, with the role name and paths changed:

```markdown
   If this role resolved to `claude`, launch the subagent exactly as described above.
   Otherwise run:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/run-role.mjs" --role challenger \
     --provider <provider> [--model <model>] --cwd "$(pwd)" \
     --input RUN/proposal.md --output RUN/challenges.md
   ```

   A non-zero exit stops the run. Report the script's stderr verbatim and do not
   fall back to `claude` — a silent substitution would make `RUN/models.json` a
   false record, which is worse than a failed run.
```

**Verify `${CLAUDE_PLUGIN_ROOT}` before relying on it.** It is unconfirmed. Test it in a headless `claude -p` run. If it is unset there, this is the same class of bug as `$CLAUDE_PROJECT_DIR` (see lines 48–50 of this same file) — pick a documented convention and fail loudly when the script is absent, never skip the external role silently.

- [ ] **Step 5: Add the report line to step 6**

```markdown
   - One line naming the models, marking external roles so the weaker isolation
     guarantee is visible in the report and not only in a file:
     `Models: proposer=claude, challenger=codex (external), resolver=claude`
```

- [ ] **Step 6: Verify the plugin still validates**

Run: `claude plugin validate ./plugins/jugalbandi --strict && node scripts/check-plugin.mjs`
Expected: both pass

- [ ] **Step 7: Commit**

```bash
git add plugins/jugalbandi/skills/plan/SKILL.md
git commit -m "Wire per-role model dispatch into /jugalbandi:plan"
```

---

### Task 9: Wire `/jugalbandi:challenge` and `/jugalbandi:review`

These read the config file but gain no flags — their argument hints stay as they are. A config value that only half the plugin respected would be a footgun.

**Files:**
- Modify: `plugins/jugalbandi/skills/challenge/SKILL.md`, `plugins/jugalbandi/skills/review/SKILL.md`

- [ ] **Step 1: Widen both frontmatter allowlists**

Add `Bash(node *), Bash(cat .jugalbandi.json)` to each.

- [ ] **Step 2: Add the branch to challenge step 2 and review step 4**

Same paragraph shape as Task 8 step 4, using `challenger` / `reviewer` and each skill's existing paths. No `models.json` — neither skill has the round or audit-trail machinery that file belongs to.

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
"test": "node --test tests/"
```

- [ ] **Step 2: Add unit tests to the existing CI job**

```yaml
      - name: Unit tests
        run: npm test
```

- [ ] **Step 3: Add the probes as a separate job**

They cost real tokens and need an authenticated CLI, so they cannot gate every pull request the way the static checks do. They must run on a schedule and on demand — a CLI upgrade that silently reopens a context channel is the failure mode, and nothing else would catch it.

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

Add a `schedule:` trigger (weekly) alongside the existing `on:` keys.

- [ ] **Step 4: Document the config file**

In `plugins/jugalbandi/README.md`, add a section covering `.jugalbandi.json`, the provider table including antigravity's not-enabled status, the `--<role>=` flags, and — most importantly — that an external role's isolation is prompt-level rather than structural, and can read `git log`. A user choosing a provider should know what they are trading.

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

- `node --test tests/` passes.
- `node plugins/jugalbandi/scripts/probes/isolation.mjs` passes both probes, including Probe A's negative control actually leaking.
- `/jugalbandi:plan` with no config file produces artifacts and a report identical in shape to today's.
- `/jugalbandi:plan --challenger=codex` produces a `RUN/models.json` naming the provider and CLI version, three artifacts, and a report line marking the Challenger external.
- A config naming `antigravity` stops the run with a message about unrun probes, not an unknown-provider error.
