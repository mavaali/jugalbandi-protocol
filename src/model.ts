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
