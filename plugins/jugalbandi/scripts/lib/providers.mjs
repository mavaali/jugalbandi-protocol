// Per-provider invocation. Pure — builds commands, runs nothing.

// Validated as a SET by the isolation probes, not flag-by-flag: three flags were changed
// together when the AGENTS.md leak closed, so which one did the work is unknown. Do not
// drop one because it looks redundant. Re-run the probes if you change this line.
export const NEUTRALIZE = {
  codex: ["--ephemeral", "--ignore-user-config", "-c", "project_doc_max_bytes=0"],
};

export function buildInvocation({ provider, model, prompt, cwd, lastMessageFile }) {
  if (provider === "claude") {
    throw new Error("claude runs as a native subagent and never goes through the adapter");
  }
  if (provider !== "codex") throw new Error(`unknown provider "${provider}"`);

  return {
    command: "codex",
    args: [
      "exec",
      "--sandbox", "read-only",
      "--skip-git-repo-check",
      ...NEUTRALIZE.codex,
      "-C", cwd,
      "-o", lastMessageFile,
      ...(model ? ["-m", model] : []),
      prompt,
    ],
  };
}
