import Anthropic from "@anthropic-ai/sdk";
import { BASELINE_PROMPT } from "./prompts.js";

const MODEL = "claude-sonnet-4-20250514";

export interface BaselineResult {
  output: string;
  assumptions_surfaced: number;
  self_critiques: number;
  escalations: number;
  plan_summary: string;
}

function countListItems(sectionText: string): number {
  const untilNextSection = sectionText.split(/^##/m)[0];
  return (untilNextSection.match(/^[\s]*[-*]\s|^\s*\d+\.\s/gm) || []).length;
}

function countAssumptions(text: string): number {
  // Match "## Assumptions", "## 2. Assumptions Made", etc.
  const match = text.split(/^##[^#\n]*assumption/im);
  if (match.length < 2) return 0;
  return countListItems(match[1]);
}

function countCritiques(text: string): number {
  // Match "## Self-Critique", "## 3. Self-Critique - Flaws", "## Flaws", etc.
  const match = text.split(/^##[^#\n]*(?:crit|flaw)/im);
  if (match.length < 2) return 0;
  // Count sub-sections (### Flaw 1, ### Flaw 2) or list items
  const section = match[1].split(/^##(?!#)/m)[0];
  const subSections = (section.match(/^###\s/gm) || []).length;
  if (subSections > 0) return subSections;
  return countListItems(section);
}

export async function runBaseline(task: string): Promise<BaselineResult> {
  const client = new Anthropic();

  console.log("  [Baseline] single-pass generation...");
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: BASELINE_PROMPT,
    messages: [{ role: "user", content: task }],
  });

  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type");
  const output = block.text;

  return {
    output,
    assumptions_surfaced: countAssumptions(output),
    self_critiques: countCritiques(output),
    escalations: (output.match(/\*?\*?Escalated\*?\*?/gi) || []).length,
    plan_summary: output.slice(0, 500),
  };
}
