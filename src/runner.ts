import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load .env manually — dotenv/dotenvx interceptor wasn't passing vars through
const envPath = resolve(import.meta.dirname!, "..", ".env");
for (const line of readFileSync(envPath, "utf-8").split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}
import { runJugalbandi } from "./protocol.js";
import { runBaseline } from "./baseline.js";
import { runCouncil } from "./council.js";

const TASKS = [
  { id: 1, slug: "login", task: "Build a login page" },
  { id: 2, slug: "cicd", task: "Set up CI/CD for a Python monorepo" },
  { id: 3, slug: "multitenant", task: "Design the data model for a multi-tenant SaaS app" },
  { id: 4, slug: "notifications", task: "Add real-time notifications to an existing REST API" },
  { id: 5, slug: "migration", task: "Migrate a PostgreSQL database to a new schema with zero downtime" },
];

interface TaskResult {
  task: string;
  single_pass: {
    assumptions_surfaced: number;
    self_critiques: number;
    plan_summary: string;
    raw_output: string;
  };
  council: {
    total_assumptions: number;
    total_critiques: number;
    unique_assumptions_estimate: number;
    raw_outputs: string[];
  };
  jugalbandi: {
    proposer_assumptions: number;
    challenger_challenges: number;
    challenge_tags: { STRUCTURAL: number; ASSUMPTION: number; MISSING: number };
    resolver_dispositions: { accepted: number; rejected: number; escalated: number };
    final_plan_summary: string;
    raw_outputs: { proposer: string; challenger: string; resolver: string };
  };
  delta: {
    new_assumptions_found: number;
    non_trivial_challenges: number;
    plan_changed: boolean;
  };
}

function parseTaskArg(): number[] {
  const idx = process.argv.indexOf("--task");
  if (idx === -1) return TASKS.map((t) => t.id);
  const val = parseInt(process.argv[idx + 1], 10);
  if (isNaN(val) || val < 1 || val > 5) {
    console.error("Usage: runner.ts [--task 1-5]");
    process.exit(1);
  }
  return [val];
}

async function main() {
  const taskIds = parseTaskArg();
  const resultsDir = resolve(import.meta.dirname!, "..", "results");
  mkdirSync(resultsDir, { recursive: true });

  for (const id of taskIds) {
    const { slug, task } = TASKS[id - 1];
    console.log(`\n=== Task ${id}: ${task} ===\n`);

    const baseline = await runBaseline(task);
    const council = await runCouncil(task);
    const jugalbandi = await runJugalbandi(task);

    const result: TaskResult = {
      task,
      single_pass: {
        assumptions_surfaced: baseline.assumptions_surfaced,
        self_critiques: baseline.self_critiques,
        plan_summary: baseline.plan_summary,
        raw_output: baseline.output,
      },
      council: {
        total_assumptions: council.total_assumptions,
        total_critiques: council.total_critiques,
        unique_assumptions_estimate: council.unique_assumptions_estimate,
        raw_outputs: council.outputs,
      },
      jugalbandi: {
        proposer_assumptions: jugalbandi.proposer_assumptions,
        challenger_challenges: jugalbandi.challenger_challenges,
        challenge_tags: jugalbandi.challenge_tags,
        resolver_dispositions: jugalbandi.resolver_dispositions,
        final_plan_summary: jugalbandi.final_plan_summary,
        raw_outputs: {
          proposer: jugalbandi.proposer_output,
          challenger: jugalbandi.challenger_output,
          resolver: jugalbandi.resolver_output,
        },
      },
      delta: {
        new_assumptions_found: Math.max(0, jugalbandi.proposer_assumptions - baseline.assumptions_surfaced),
        non_trivial_challenges: jugalbandi.challenger_challenges,
        plan_changed: jugalbandi.resolver_dispositions.accepted > 0,
      },
    };

    const outPath = resolve(resultsDir, `task-${id}-${slug}.json`);
    writeFileSync(outPath, JSON.stringify(result, null, 2));
    console.log(`  → Written to ${outPath}`);

    console.log(`\n  Summary:`);
    console.log(`    Baseline:    ${baseline.assumptions_surfaced} assumptions, ${baseline.self_critiques} critiques, ${baseline.escalations} escalations`);
    console.log(`    Council:     ${council.unique_assumptions_estimate} assumptions (est. unique), ${council.total_critiques} critiques (3 passes)`);
    console.log(`    Jugalbandi:  ${jugalbandi.proposer_assumptions} assumptions, ${jugalbandi.challenger_challenges} challenges`);
    console.log(`    Dispositions: ${JSON.stringify(jugalbandi.resolver_dispositions)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
