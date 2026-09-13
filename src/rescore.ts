import "./env.js"; // must come first: loads ANTHROPIC_API_KEY before any client is built
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { judgeRepeated } from "./judge.js";
import { MODEL } from "./model.js";

// Re-scores the ORIGINAL five-task results with the semantic judge.
//
// Why the original data rather than a fresh run: the model those runs used
// (claude-sonnet-4-20250514) is retired, so the published numbers can never be
// regenerated. But the full raw outputs were saved. Re-scoring them changes only the
// measurement, leaving the generation conditions exactly as they were when the claim was
// made — which is the only way to test that claim against the data behind it.
//
// Three texts per task, all scored by the identical blind judge:
//   single_pass  — the control arm's whole output
//   proposer     — what the published metric actually counted
//   resolver     — the protocol's final deliverable, never measured by the original
//                  instrument, and arguably the thing that should have been
//
// Usage: npx tsx src/rescore.ts [--repeats N]

const REPEATS = (() => {
  const i = process.argv.indexOf("--repeats");
  return i === -1 ? 3 : Math.max(1, parseInt(process.argv[i + 1], 10) || 3);
})();

const ROOT = resolve(import.meta.dirname!, "..");
const SRC = resolve(ROOT, "results", "v1-original");
const OUT = resolve(ROOT, "results", "rescored");

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);

interface Row {
  task: string;
  arm: string;
  regex: number;
  counts: number[];
  mean: number;
  spread: number;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const files = readdirSync(SRC).filter((f) => f.endsWith(".json")).sort();
  const rows: Row[] = [];

  for (const file of files) {
    const data = JSON.parse(readFileSync(resolve(SRC, file), "utf-8"));
    const task = file.replace(/^task-\d+-|\.json$/g, "");

    const arms: Array<[string, string, number]> = [
      ["single_pass", data.single_pass.raw_output, data.single_pass.assumptions_surfaced],
      ["proposer", data.jugalbandi.raw_outputs.proposer, data.jugalbandi.proposer_assumptions],
      // Never measured by the original instrument. No regex figure exists to compare to,
      // so -1 marks "not previously scored" rather than a count of zero.
      ["resolver", data.jugalbandi.raw_outputs.resolver, -1],
    ];

    for (const [arm, text, regexCount] of arms) {
      process.stdout.write(`  ${task} / ${arm} ... `);
      const counts = await judgeRepeated(text, REPEATS);
      const row: Row = { task, arm, regex: regexCount, counts, mean: mean(counts), spread: spread(counts) };
      rows.push(row);
      console.log(`${counts.join(", ")}  (regex said ${regexCount === -1 ? "n/a" : regexCount})`);
    }
  }

  writeFileSync(
    resolve(OUT, "assumptions.json"),
    JSON.stringify({ judge_model: MODEL, repeats: REPEATS, generated: new Date().toISOString(), rows }, null, 2),
  );

  // --- report -------------------------------------------------------------
  console.log(`\n${"task".padEnd(14)}${"arm".padEnd(13)}${"regex".padStart(6)}${"judge".padStart(8)}${"spread".padStart(8)}`);
  for (const r of rows) {
    console.log(
      r.task.padEnd(14) + r.arm.padEnd(13) +
      String(r.regex === -1 ? "n/a" : r.regex).padStart(6) +
      r.mean.toFixed(1).padStart(8) + String(r.spread).padStart(8),
    );
  }

  const by = (arm: string) => rows.filter((r) => r.arm === arm);
  const avg = (arm: string) => mean(by(arm).map((r) => r.mean));
  const worstSpread = Math.max(...rows.map((r) => r.spread));

  console.log(`\n  Judge means — single_pass ${avg("single_pass").toFixed(1)}, ` +
    `proposer ${avg("proposer").toFixed(1)}, resolver ${avg("resolver").toFixed(1)}`);
  console.log(`  Regex means — single_pass ${mean(by("single_pass").map((r) => r.regex)).toFixed(1)}, ` +
    `proposer ${mean(by("proposer").map((r) => r.regex)).toFixed(1)}`);
  console.log(`  Judge ratio proposer/single_pass: ${(avg("proposer") / avg("single_pass")).toFixed(2)}x ` +
    `(regex claimed 2.7x)`);
  console.log(`  Largest within-text judge spread across ${REPEATS} repeats: ${worstSpread}`);
  console.log(`\n  A difference between arms smaller than that spread is not a finding.`);
  console.log(`  → ${resolve(OUT, "assumptions.json")}`);
}

main();
