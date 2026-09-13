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
  // resolver.md's contract contains exactly that shape, and a naive splice cuts inside the
  // fence — orphaning it and leaving the old contract sitting below the new one.
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
