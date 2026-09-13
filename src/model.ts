// The model every arm runs on. Single source of truth: all three arms must use the same
// model or the comparison between them is meaningless, and three separate copies of a
// pinned string is exactly how that drifts.
//
// The original five-task results in results/v1-original/ were produced on
// claude-sonnet-4-20250514, which is now retired and returns not_found_error. Numbers from
// any later run are therefore NOT directly comparable to the README's 9.4 / 14.2 / 25.4
// table. What remains valid is the comparison *between arms within a single run*, since
// they share a model — which is what the matched-elicitation ablation needs.
//
// Override with JUGALBANDI_MODEL to re-run a comparison on a different model.
export const MODEL = process.env.JUGALBANDI_MODEL ?? "claude-sonnet-5";

/**
 * Pull the text out of a response.
 *
 * The original code read `response.content[0]` and threw if it was not a text block. That
 * held for claude-sonnet-4, which returned a single text block. Newer models can emit
 * other block types (e.g. thinking) first, and intermittently do — the same prompt
 * succeeded on one call and threw on the next. Concatenating every text block is correct
 * for both shapes.
 *
 * Whatever reasoning blocks the model emits apply to all arms equally, so the within-run
 * comparison stays controlled; they are simply not part of the measured artifact.
 */
export function textOf(response: { content: Array<{ type: string; text?: string }> }): string {
  const text = response.content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
  if (!text) {
    throw new Error(
      `no text block in response (got: ${response.content.map((b) => b.type).join(", ") || "nothing"})`,
    );
  }
  return text;
}
