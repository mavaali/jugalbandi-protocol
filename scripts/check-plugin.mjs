#!/usr/bin/env node
// Static checks for the Jugalbandi plugin. No dependencies, no network, no auth —
// so this can gate every pull request.
//
// `claude plugin validate` covers manifest shape. These checks cover what it can't:
// version drift between the two manifests that both declare a version, and skills
// that reference agents which don't exist.
//
// Usage: node scripts/check-plugin.mjs

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = resolve(ROOT, "plugins/jugalbandi");

const failures = [];
const fail = (msg) => failures.push(msg);

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    fail(`${path}: ${err.message}`);
    return null;
  }
}

/** Minimal frontmatter reader — enough for the flat `key: value` fields we use. */
function frontmatter(path) {
  const text = readFileSync(path, "utf-8");
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return { fields: null, body: text };
  const fields = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^([a-zA-Z][\w-]*):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  return { fields, body: text.slice(match[0].length) };
}

// --- manifests -------------------------------------------------------------

const manifest = readJson(resolve(PLUGIN, ".claude-plugin/plugin.json"));
const marketplace = readJson(resolve(ROOT, ".claude-plugin/marketplace.json"));

if (manifest && !manifest.name) fail("plugin.json: missing `name`");

let entry = null;
if (marketplace) {
  if (!Array.isArray(marketplace.plugins)) {
    fail("marketplace.json: `plugins` must be an array");
  } else {
    entry = marketplace.plugins.find((p) => p.name === manifest?.name);
    if (!entry) {
      fail(`marketplace.json: no entry named "${manifest?.name}"`);
    } else if (typeof entry.source === "string") {
      const dir = resolve(ROOT, entry.source);
      if (!existsSync(resolve(dir, ".claude-plugin/plugin.json"))) {
        fail(`marketplace.json: source "${entry.source}" has no .claude-plugin/plugin.json`);
      }
    }
  }
}

// Both manifests may carry a version, and plugin.json wins at load time. A stale
// marketplace version silently misreports what users are installing.
if (manifest?.version && entry?.version && manifest.version !== entry.version) {
  fail(
    `version drift: plugin.json is ${manifest.version}, marketplace entry is ${entry.version}`,
  );
}

// --- agents ----------------------------------------------------------------

const agentDir = resolve(PLUGIN, "agents");
const agentNames = new Set();

for (const file of readdirSync(agentDir).filter((f) => f.endsWith(".md"))) {
  const path = resolve(agentDir, file);
  const { fields } = frontmatter(path);
  if (!fields) {
    fail(`agents/${file}: no YAML frontmatter`);
    continue;
  }
  if (!fields.name) fail(`agents/${file}: missing \`name\``);
  if (!fields.description) fail(`agents/${file}: missing \`description\``);
  if (fields.name && fields.name !== basename(file, ".md")) {
    fail(`agents/${file}: name "${fields.name}" does not match the filename`);
  }
  if (fields.name) agentNames.add(fields.name);
}

// --- skills ----------------------------------------------------------------

const skillDir = resolve(PLUGIN, "skills");

for (const dir of readdirSync(skillDir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
  const path = resolve(skillDir, dir.name, "SKILL.md");
  if (!existsSync(path)) {
    fail(`skills/${dir.name}: no SKILL.md`);
    continue;
  }
  const { fields, body } = frontmatter(path);
  if (!fields) {
    fail(`skills/${dir.name}/SKILL.md: no YAML frontmatter`);
    continue;
  }
  if (!fields.description) fail(`skills/${dir.name}/SKILL.md: missing \`description\``);
  if (fields.name && fields.name !== dir.name) {
    fail(`skills/${dir.name}/SKILL.md: name "${fields.name}" does not match the directory`);
  }

  // The failure this file exists for: a skill telling the model to launch an agent
  // that isn't shipped. Nothing else catches it until the skill runs and stalls.
  const referenced = new Set(
    [...body.matchAll(/`?jugalbandi:([a-z][\w-]*)`?/g)].map((m) => m[1]),
  );
  for (const name of referenced) {
    // Skills reference each other too; only unknown names are a problem.
    if (agentNames.has(name)) continue;
    if (existsSync(resolve(skillDir, name, "SKILL.md"))) continue;
    fail(`skills/${dir.name}/SKILL.md: references jugalbandi:${name}, which is not a shipped agent or skill`);
  }
}

// --- report ----------------------------------------------------------------

if (failures.length) {
  console.error(`✗ ${failures.length} problem${failures.length === 1 ? "" : "s"}:\n`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(`✓ plugin checks passed (${agentNames.size} agents, ${readdirSync(skillDir).length} skills)`);
