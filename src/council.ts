import Anthropic from "@anthropic-ai/sdk";
import { BASELINE_PROMPT } from "./prompts.js";

const MODEL = "claude-sonnet-4-20250514";

export interface CouncilResult {
  outputs: string[];
  total_assumptions: number;
  total_critiques: number;
  unique_assumptions_estimate: number;
}

function countAssumptions(text: string): number {
  const match = text.split(/^##[^#\n]*assumption/im);
  if (match.length < 2) return 0;
  const untilNextSection = match[1].split(/^##(?!#)/m)[0];
  return (untilNextSection.match(/^[\s]*[-*]\s|^\s*\d+\.\s/gm) || []).length;
}

function countCritiques(text: string): number {
  const match = text.split(/^##[^#\n]*(?:crit|flaw)/im);
  if (match.length < 2) return 0;
  const section = match[1].split(/^##(?!#)/m)[0];
  const subSections = (section.match(/^###\s/gm) || []).length;
  if (subSections > 0) return subSections;
  return (section.match(/^[\s]*[-*]\s|^\s*\d+\.\s/gm) || []).length;
}

export async function runCouncil(task: string): Promise<CouncilResult> {
  const client = new Anthropic();

  // Run 3 independent passes in parallel — same total API budget as Jugalbandi
  console.log("  [Council] running 3 independent passes...");
  const results = await Promise.all(
    [1, 2, 3].map(async (i) => {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: BASELINE_PROMPT,
        messages: [{ role: "user", content: task }],
      });
      const block = response.content[0];
      if (block.type !== "text") throw new Error("Unexpected response type");
      console.log(`    Pass ${i} complete`);
      return block.text;
    })
  );

  const assumptions = results.map(countAssumptions);
  const critiques = results.map(countCritiques);

  // Sum across all 3 passes (generous — overcounts overlapping assumptions)
  const totalAssumptions = assumptions.reduce((a, b) => a + b, 0);
  const totalCritiques = critiques.reduce((a, b) => a + b, 0);

  // Conservative estimate: best single pass + 30% of others (overlap discount)
  const maxAssumptions = Math.max(...assumptions);
  const othersSum = totalAssumptions - maxAssumptions;
  const uniqueEstimate = Math.round(maxAssumptions + othersSum * 0.3);

  return {
    outputs: results,
    total_assumptions: totalAssumptions,
    total_critiques: totalCritiques,
    unique_assumptions_estimate: uniqueEstimate,
  };
}
