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

test("the error names the role that was misconfigured", () => {
  assert.throws(() => resolveChallenger({ models: { challenger: "gpt4" } }, null), /challenger:/);
});
