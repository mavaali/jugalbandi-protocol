// Structural validation for the artifact an external Challenger produces.
//
// A native subagent writes its artifact with a tool call; it exists or it doesn't. An
// external role's artifact is whatever it said last, so "non-empty" is not a sufficient
// bar — a prose summary passes that and then degrades every downstream consumer silently.
// The conductor counts these same tags to build its tally and would report zero as a clean
// result.

const TAGGED = /^### \[(STRUCTURAL|ASSUMPTION|MISSING)\] \S/gm;

export function validateChallenges(content) {
  if (!content || !content.trim()) return { ok: false, missing: ["any content at all"] };

  const count = (content.match(TAGGED) ?? []).length;
  if (count < 3) {
    return {
      ok: false,
      missing: [`at least three '### [TAG] <claim>' headings tagged STRUCTURAL, ASSUMPTION or MISSING (found ${count})`],
    };
  }
  return { ok: true, missing: [] };
}
