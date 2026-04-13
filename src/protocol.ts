import Anthropic from "@anthropic-ai/sdk";
import { PROPOSER_PROMPT, CHALLENGER_PROMPT, RESOLVER_PROMPT } from "./prompts.js";

const MODEL = "claude-sonnet-4-20250514";

export interface JugalbandiResult {
  proposer_output: string;
  proposer_assumptions: number;
  challenger_output: string;
  challenger_challenges: number;
  challenge_tags: { STRUCTURAL: number; ASSUMPTION: number; MISSING: number };
  resolver_output: string;
  resolver_dispositions: { accepted: number; rejected: number; escalated: number };
  final_plan_summary: string;
}

function countAssumptions(text: string): number {
  const match = text.split(/^##[^#\n]*assumption/im);
  if (match.length < 2) return 0;
  const untilNextSection = match[1].split(/^##(?!#)/m)[0];
  return (untilNextSection.match(/^[\s]*[-*]\s|^\s*\d+\.\s/gm) || []).length;
}

function countChallengeTags(text: string): { STRUCTURAL: number; ASSUMPTION: number; MISSING: number } {
  return {
    STRUCTURAL: (text.match(/\[STRUCTURAL\]/gi) || []).length,
    ASSUMPTION: (text.match(/\[ASSUMPTION\]/gi) || []).length,
    MISSING: (text.match(/\[MISSING\]/gi) || []).length,
  };
}

function countDispositions(text: string): { accepted: number; rejected: number; escalated: number } {
  return {
    accepted: (text.match(/\*?\*?Accepted\*?\*?/gi) || []).length,
    rejected: (text.match(/\*?\*?Rejected\*?\*?/gi) || []).length,
    escalated: (text.match(/\*?\*?Escalated\*?\*?/gi) || []).length,
  };
}

async function call(client: Anthropic, system: string, user: string): Promise<string> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: user }],
  });
  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type");
  return block.text;
}

export async function runJugalbandi(task: string): Promise<JugalbandiResult> {
  const client = new Anthropic();

  console.log("  [Proposer] generating plan...");
  const proposerOutput = await call(client, PROPOSER_PROMPT, task);

  console.log("  [Challenger] reviewing...");
  const challengerOutput = await call(client, CHALLENGER_PROMPT, proposerOutput);

  console.log("  [Resolver] deciding...");
  const resolverInput = `## Proposal\n\n${proposerOutput}\n\n## Challenges\n\n${challengerOutput}`;
  const resolverOutput = await call(client, RESOLVER_PROMPT, resolverInput);

  const tags = countChallengeTags(challengerOutput);

  return {
    proposer_output: proposerOutput,
    proposer_assumptions: countAssumptions(proposerOutput),
    challenger_output: challengerOutput,
    challenger_challenges: tags.STRUCTURAL + tags.ASSUMPTION + tags.MISSING,
    challenge_tags: tags,
    resolver_output: resolverOutput,
    resolver_dispositions: countDispositions(resolverOutput),
    final_plan_summary: resolverOutput.slice(0, 500),
  };
}
