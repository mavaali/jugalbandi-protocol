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
  // challenger.md requires `### [TAG] <one-line claim>`. A bare tag is not a challenge.
  assert.equal(validateChallenges("### [STRUCTURAL]\n### [MISSING]\n### [ASSUMPTION]\n").ok, false);
});

test("the failure says what was missing", () => {
  assert.match(validateChallenges("nope").missing.join(" "), /three/);
});
