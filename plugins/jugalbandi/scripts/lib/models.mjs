// Resolution order: config file, then the per-run flag. Nothing here touches the
// filesystem or a child process — the caller supplies parsed inputs.

const PROVIDERS = {
  claude: { takesModel: false },
  codex: { takesModel: true },
};

export function parseAssignment(value) {
  const idx = value.indexOf(":");
  const provider = idx === -1 ? value : value.slice(0, idx);
  const model = idx === -1 ? null : value.slice(idx + 1) || null;

  const spec = PROVIDERS[provider];
  if (!spec) {
    throw new Error(`unknown provider "${provider}" — expected one of ${Object.keys(PROVIDERS).join(", ")}`);
  }
  if (model && !spec.takesModel) {
    throw new Error(`provider "${provider}" does not take a model (got "${value}")`);
  }
  return { provider, model };
}

export function resolveChallenger(config, flag) {
  const models = config?.models ?? {};

  // Only the Challenger can run externally today. Rejecting the others loudly beats
  // ignoring them: a user who sets resolver=codex and sees a normal run would otherwise
  // believe a model they never used produced the plan.
  for (const [role, value] of Object.entries(models)) {
    if (role === "challenger") continue;
    if (value === "claude") continue;
    throw new Error(
      `only \`challenger\` may be assigned an external provider (got ${role}="${value}")`,
    );
  }

  try {
    return parseAssignment(flag ?? models.challenger ?? "claude");
  } catch (err) {
    throw new Error(`challenger: ${err.message}`);
  }
}
