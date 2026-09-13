import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Loads .env by hand, matching what runner.ts does — the dotenv interceptor was not
// passing vars through. As a side-effect import (`import "./env.js"` placed first) this
// runs before any module that constructs an API client, because ES imports execute in
// order.
const envPath = resolve(import.meta.dirname!, "..", ".env");
try {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
} catch {
  // Absent .env is fine when the key is already exported in the environment.
}
