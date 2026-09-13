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
  assert.ok(!/using the `Write`/.test(out), "old write instruction must be gone");
  assert.match(out, /Write no files/);
  assert.match(out, /adversarial reviewer/);
  assert.match(out, /\[STRUCTURAL\]/, "the tag vocabulary must survive — validation depends on it");
});

test("buildPrompt puts instructions before the isolated message", () => {
  const p = buildPrompt("INSTRUCTIONS", "MESSAGE");
  assert.ok(p.indexOf("INSTRUCTIONS") < p.indexOf("MESSAGE"));
});
