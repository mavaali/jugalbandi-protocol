// Per-provider invocation. Pure — builds commands, runs nothing.

// Validated as a SET by the isolation probes, not flag-by-flag: three flags were changed
// together when the AGENTS.md leak closed, so which one did the work is unknown. Do not
// drop one because it looks redundant. Re-run the probes if you change this line.
export const NEUTRALIZE = {
  codex: ["--ephemeral", "--ignore-user-config", "-c", "project_doc_max_bytes=0"],
};
