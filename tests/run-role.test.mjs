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
  // PATH is REPLACED, not prepended: prepending lets lookup fall through to the real codex
  // on this machine, which would spend tokens and fail for the wrong reason. But not `bin`
  // alone — env replaces rather than extends, and the fake is a shell script needing sleep
  // and cat. process.execPath is used so replacing PATH can't break finding node.
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
