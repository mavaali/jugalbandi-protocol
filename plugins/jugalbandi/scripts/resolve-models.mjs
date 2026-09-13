#!/usr/bin/env node
// Resolves the Challenger's model for the conductor, which cannot be trusted to
// re-implement the rules in prose — the claude:<model> and other-role rejections are
// specified error behaviours, not suggestions.
//
// Usage: node resolve-models.mjs [--config <path>] [--challenger=<provider[:model]>]
// Prints the resolved assignment as JSON. Exits 1 with a message on any bad value.

import { readFileSync, existsSync } from "node:fs";
import { resolveChallenger } from "./lib/models.mjs";

const args = process.argv.slice(2);
let configPath = ".jugalbandi.json";
let flag = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--config") { configPath = args[++i]; continue; }
  const m = args[i].match(/^--challenger=(.+)$/);
  if (m) { flag = m[1]; continue; }
  console.error(`unexpected argument: ${args[i]}`);
  process.exit(1);
}

let config = null;
if (existsSync(configPath)) {
  try {
    config = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch (err) {
    console.error(`${configPath}: ${err.message}`);
    process.exit(1);
  }
}

try {
  console.log(JSON.stringify(resolveChallenger(config, flag), null, 2));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
