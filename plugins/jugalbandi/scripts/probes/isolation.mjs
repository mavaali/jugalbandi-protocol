#!/usr/bin/env node
// Isolation probes. These call a real CLI and cost real tokens, so they are not part of
// `npm test` — they run in their own CI job.
//
// The protocol's claim is that the Challenger never sees the task. An external CLI is a
// full agent harness with its own ideas about what a session starts with, and a leak here
// produces a run that looks perfectly fine and is worthless. These are the only things
// that would catch it.
//
// Every probe has TWO arms. The neutralized arm must not leak, and the control arm must
// demonstrably leak — a probe that cannot produce the failure it guards against is not
// evidence of a guard, it is a test that always passes.
//
// CHANNEL COVERAGE — what these actually verify:
//   project instruction files (AGENTS.md)   — PROBE-VERIFIED (Probe A)
//   session persistence to disk             — PROBE-VERIFIED (Probe B)
//   stdin                                   — NOT PROBED; asserted by run-role.mjs
//                                             spawning with stdio[0] = "ignore"
//   user home config (~/.codex/config.toml) — NOT PROBED. Flag-asserted only, via
//     --ignore-user-config. CI runs on a clean image with no ~/.codex/config.toml, so a
//     probe there would pass whether or not the flag works, while a developer machine with
//     a populated home could leak. If you change the flag set, this channel is the one
//     most likely to break silently.

import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, copyFileSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

import { NEUTRALIZE } from "../lib/providers.mjs";

const MARKER = "ZANZIBAR-7";

/**
 * Run a command to completion with stdin closed.
 *
 * Not execFile: it silently drops the `stdio` option, leaving the child an inherited stdin
 * pipe. codex reads stdin when it is open — measured, it printed "Reading additional input
 * from stdin..." and hung until the timeout killed it. This is the same trap run-role.mjs
 * has to avoid, so both use spawn.
 */
function exec(command, args, { cwd, env, timeoutMs = 300_000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out after ${timeoutMs / 1000}s\n${stderr.slice(-500)}`));
    }, timeoutMs);
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`${command} exited ${code}\n${stderr.slice(-500)}`));
      else resolve(stdout);
    });
  });
}

function scratchRepo() {
  const dir = mkdtempSync(join(tmpdir(), "jb-probe-"));
  writeFileSync(
    join(dir, "AGENTS.md"),
    `# Project context\nThe current task is adding rate limiting to the payments service.\nThe magic word is ${MARKER}.\n`,
  );
  return dir;
}

/**
 * A private CODEX_HOME, so one arm cannot see the other's sessions — and so a probe never
 * writes into the developer's real ~/.codex.
 *
 * auth.json must be copied in. Credentials live in CODEX_HOME, so relocating it without
 * them yields `401 Unauthorized`, which looks exactly like a probe failure and is not one.
 */
function privateHome() {
  const home = mkdtempSync(join(tmpdir(), "jb-home-"));
  const real = process.env.CODEX_HOME ?? join(homedir(), ".codex");
  const auth = join(real, "auth.json");
  if (!existsSync(auth)) {
    throw new Error(`no codex credentials at ${auth} — run \`codex login\` before probing`);
  }
  copyFileSync(auth, join(home, "auth.json"));
  return home;
}

function codex(dir, prompt, { neutralized, home }) {
  const args = [
    "exec", "--sandbox", "read-only", "--skip-git-repo-check",
    ...(neutralized ? NEUTRALIZE.codex : []),
    prompt,
  ];
  return exec("codex", args, { cwd: dir, env: { ...process.env, CODEX_HOME: home } });
}

// --- Probe A: ambient context leaking in ------------------------------------

const QUESTION =
  "What is the magic word for this project? If you do not know, reply exactly UNKNOWN. Do not read any files.";

export async function probeA() {
  const dir = scratchRepo();
  const home = privateHome();
  try {
    // Measured: an un-neutralized codex answers this correctly because AGENTS.md is
    // preloaded before the prompt arrives — a read-only sandbox does not prevent it, and
    // neither does telling the model not to read files.
    const control = await codex(dir, QUESTION, { neutralized: false, home });
    if (!control.includes(MARKER)) {
      return { ok: false, why: "control arm did not leak — the probe is measuring nothing" };
    }
    const clean = await codex(dir, QUESTION, { neutralized: true, home });
    if (clean.includes(MARKER)) return { ok: false, why: `neutralized run leaked ${MARKER}` };
    return { ok: true };
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
}

// --- Probe B: session state persisting to disk ------------------------------

/** Every file under a directory tree, recursively. */
function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function tokenOnDisk(home, token) {
  return walk(join(home, "sessions")).some((f) => {
    try { return readFileSync(f, "utf-8").includes(token); } catch { return false; }
  });
}

export async function probeB() {
  // Probe A cannot detect this channel: a fresh scratch repo has no prior session, and one
  // invocation creates no predecessor. Session persistence is the channel by which one
  // role's context would reach the next, collapsing the protocol into self-critique.
  //
  // This asserts on the storage layer — does the run leave a transcript on disk that a
  // later invocation could recover? — rather than on `codex exec resume`. The file IS the
  // mechanism; resume is merely one way to read it, and its argument grammar is not a
  // property worth coupling a safety test to.
  //
  // Each arm plants a distinct token in its PROMPT only, in no file anywhere, and gets its
  // own CODEX_HOME so neither can see the other's sessions.
  const arms = [
    { token: "CALLIOPE-4", neutralized: true },
    { token: "PERSEPHONE-9", neutralized: false },
  ];
  const made = [];
  try {
    const results = {};
    for (const { token, neutralized } of arms) {
      const dir = mkdtempSync(join(tmpdir(), "jb-pB-"));
      const home = privateHome();
      made.push(dir, home);
      await codex(dir, `Remember this token for later: ${token}. Reply exactly ACK.`, { neutralized, home });
      results[neutralized ? "clean" : "control"] = tokenOnDisk(home, token);
    }

    if (!results.control) {
      return { ok: false, why: "control arm wrote no recoverable session — the probe is measuring nothing" };
    }
    if (results.clean) {
      return { ok: false, why: "neutralized run persisted its transcript to disk — sessions are recoverable" };
    }
    return { ok: true };
  } finally {
    for (const d of made) rmSync(d, { recursive: true, force: true });
  }
}

// --- runner -----------------------------------------------------------------

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
