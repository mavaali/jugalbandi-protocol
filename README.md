# Jugalbandi Protocol

A dialectical protocol for agent task execution. Three roles, one model, isolated contexts — testing whether structured adversarial challenge produces measurably different outputs than single-pass self-critique.

Named after the Hindustani classical music duet where two musicians push each other to perform at a higher level.

## The Protocol

```
Task → Proposer (plan + assumptions) → Challenger (min 3 tagged challenges) → Resolver (dispositions) → Output
```

- **Proposer**: Produces an implementation plan and declares every unstated assumption
- **Challenger**: Adversarial reviewer. Cannot approve. Tags challenges as `[STRUCTURAL]`, `[ASSUMPTION]`, or `[MISSING]`
- **Resolver**: Dispositions every challenge as accepted (with revision), rejected (with justification), or escalated (needs human input)

Context isolation is the mechanism — the Challenger never sees the Proposer's system prompt, the Resolver sees both outputs but neither system prompt.

## Comparison

Every task runs through three paths:

1. **Single-pass**: One call — plan, assumptions, self-critique, revise
2. **Council**: Three independent single-pass calls in parallel (same compute budget as Jugalbandi)
3. **Jugalbandi**: The three-role loop above

## Results

Across 5 ambiguous engineering tasks (Claude Sonnet 4):

| Metric | Single-Pass | Council (3x) | Jugalbandi |
|--------|------------|--------------|------------|
| Assumptions surfaced (avg) | 9.4 | 14.2 | 25.4 |
| Critiques/challenges (avg) | 4.8 | 12.8 | 7.2 |

The assumption surfacing gap (2.7x single-pass, 1.8x council) is the result that survived ablation testing. See the blog post for the full story — including an escalation claim that didn't survive and what replaced it.

## Usage

```bash
cp .env.example .env  # add your ANTHROPIC_API_KEY
npm install
npx tsx src/runner.ts --task 1  # run one task (1-5)
npx tsx src/runner.ts           # run all 5 tasks
```

Results are written to `results/task-N-slug.json`.

## Claude Code Plugin

The protocol also ships as a Claude Code plugin, so you can run it against a real codebase instead of a benchmark task:

```bash
/plugin marketplace add mavaali/jugalbandi-protocol
/plugin install jugalbandi@jugalbandi-protocol

/jugalbandi:plan Add multi-region failover to the payments service
/jugalbandi:challenge docs/rfc-042.md
```

Each role is a separate subagent, so half the isolation is structural: the harness guarantees a subagent starts with no context beyond the prompt it is handed, and no amount of sloppy prompting can leak the Proposer's reasoning into the Challenger's head. The other half — not pasting the task text into that prompt in the first place — is still discipline, enforced by rules in the skill rather than by the runtime. Escalations come back as questions you actually get asked. See [`plugins/jugalbandi/`](plugins/jugalbandi/README.md).

## Blog Post

[Jugalbandi Protocol: What Happens When You Force AI Agents to Argue](https://www.waglesworld.com/blog/jugalbandi-protocol-what-happens-when-you-force-ai-agents-to-argue)
