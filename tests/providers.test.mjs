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

test("an unknown provider is rejected", () => {
  assert.throws(() => buildInvocation({ ...base, provider: "gpt4" }), /unknown provider/i);
});
