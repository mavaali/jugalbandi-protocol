import Anthropic from "@anthropic-ai/sdk";
import { MODEL, textOf } from "./model.js";

// A semantic counter for assumptions, replacing the regex counters.
//
// The regex counters grep for headings and bullet formats. Two problems with that, both
// measured: (1) PROPOSER_PROMPT and CHALLENGER_PROMPT specify the exact strings the
// counters look for while BASELINE_PROMPT does not, so the control arm is scored on
// formats it was never told to use; (2) on a current model the counters return 0 for a
// third of outputs, including ones that plainly contain the content.
// See docs/findings/2026-09-12-assumption-metric-confound.md
//
// Three properties this judge needs, or it just relocates the bias:
//   - BLIND. It never learns which arm produced the text. The caller passes text only.
//   - IDENTICAL. One prompt, byte-for-byte, for every input.
//   - NEUTRAL. The definition of "assumption" is written here, not lifted from
//     PROPOSER_PROMPT — reusing that wording would re-import the very bias being removed.
//
// It returns labels, not just a count, so a human can audit what it counted.

const JUDGE_PROMPT = `You are counting assumptions in an engineering plan.

An assumption is a decision, constraint, or fact that the author treated as settled but
which the task statement did not specify. This includes:
- a technology, library, platform, or pattern chosen without the task requiring it
- a scope boundary the author drew themselves (what is in or out of the work)
- a default behaviour, limit, or policy the author selected
- a claim about the existing system, team, or organisation that was not given
- an inferred requirement the task never stated

Count each distinct assumption once. Do NOT count:
- restatements of what the task explicitly asked for
- open questions the author poses to the reader without settling
- two phrasings of the same underlying decision

An assumption counts wherever it appears — a dedicated section, a bulleted list, inline in
prose, or embedded inside a technical decision. Headings and formatting are irrelevant to
your count; judge the substance only.

Label each assumption in at most eight words. The labels exist so a human can audit what
you counted, not to restate the plan — keep them terse.

Respond with JSON and nothing else, in exactly this shape:
{"assumptions": ["short label", "short label", ...]}`;

// Sonnet 5 rates, $ per million tokens. If MODEL is overridden to something else these
// figures are wrong and the reported cost is meaningless — check before trusting it.
const RATES: Record<string, { in: number; out: number }> = {
  "claude-sonnet-5": { in: 2.0, out: 10.0 },
  "claude-opus-5": { in: 5.0, out: 25.0 },
  "claude-haiku-4-5": { in: 1.0, out: 5.0 },
};

export interface Usage {
  input: number;
  output: number;
  cost: number;
}

// Accumulates across every judge call in a process, so a run reports what it actually
// spent instead of an estimate. Thinking tokens bill as output and are the bulk of the
// cost here, which is exactly the part an estimate gets wrong.
export const totalUsage: Usage = { input: 0, output: 0, cost: 0 };

export function costOf(input: number, output: number): number {
  const r = RATES[MODEL];
  if (!r) return 0; // unknown model: report 0 rather than invent a rate
  return (input / 1e6) * r.in + (output / 1e6) * r.out;
}

export function formatUsage(u: Usage): string {
  const known = MODEL in RATES;
  return `${u.input.toLocaleString()} in / ${u.output.toLocaleString()} out` +
    (known ? ` = $${u.cost.toFixed(3)}` : ` (no rate on file for ${MODEL})`);
}

export interface JudgeResult {
  count: number;
  labels: string[];
  usage: Usage;
}

export async function judgeAssumptions(text: string): Promise<JudgeResult> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    // Generous, because a long list of assumptions is the expected case and a truncated
    // response is an undercount. 4096 was not enough: it clipped mid-string on an output
    // with ~39 assumptions, which is exactly the high-count case the measurement is for.
    max_tokens: 16000,
    // No temperature: deprecated for this model, so determinism cannot be pinned here.
    // That is precisely why judgeRepeated exists and why its spread is reported alongside
    // every result rather than treated as a formality.
    system: JUDGE_PROMPT,
    messages: [{ role: "user", content: text }],
  });

  const raw = textOf(response).trim();
  // Tolerate a fenced block around the JSON; fail loudly on anything else rather than
  // silently returning 0, which is the failure mode this judge exists to eliminate.
  const json = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: { assumptions?: unknown };
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`judge did not return JSON: ${raw.slice(0, 200)}`);
  }
  if (!Array.isArray(parsed.assumptions)) {
    throw new Error(`judge returned no assumptions array: ${raw.slice(0, 200)}`);
  }
  const labels = parsed.assumptions.map(String);

  const input = response.usage.input_tokens;
  const output = response.usage.output_tokens;
  const usage: Usage = { input, output, cost: costOf(input, output) };
  totalUsage.input += input;
  totalUsage.output += output;
  totalUsage.cost += usage.cost;

  return { count: labels.length, labels, usage };
}

/**
 * Score the same text several times to measure the judge's own variance.
 *
 * Without this the judge is exactly what the regex counters were: an unvalidated
 * instrument producing numbers nobody has checked for stability. Any difference between
 * arms smaller than this spread is not a finding.
 */
export async function judgeRepeated(text: string, repeats: number): Promise<number[]> {
  const counts: number[] = [];
  for (let i = 0; i < repeats; i++) {
    counts.push((await judgeAssumptions(text)).count);
  }
  return counts;
}
