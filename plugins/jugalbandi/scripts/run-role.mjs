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
// pipe. codex reads stdin when it is open — measured, it printed "Reading additional input
// from stdin..." and hung until a timeout killed it.
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
