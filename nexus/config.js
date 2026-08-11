export function loadNexusConfig(env = process.env) {
  const enabled = env.NEXUS_ENABLED === 'true';
  const shadow = env.NEXUS_SHADOW !== 'false';
  const pollMs = clampInt(env.NEXUS_POLL_MS, 30_000, 5_000, 300_000);
  const maxWip = clampInt(env.NEXUS_MAX_WIP, 3, 1, 10);
  const dailyCostCapUsd = clampNumber(env.NEXUS_DAILY_COST_CAP_USD, 10, 0, 10_000);

  return Object.freeze({
    enabled,
    shadow,
    pollMs,
    maxWip,
    dailyCostCapUsd,
    externalWritesAllowed: false,
  });
}

function clampInt(raw, fallback, min, max) {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function clampNumber(raw, fallback, min, max) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
