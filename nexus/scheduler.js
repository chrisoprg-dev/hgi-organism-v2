const STATE = Object.freeze({
  READY: 'READY',
  CLAIMED: 'CLAIMED',
  RUNNING: 'RUNNING',
  DONE: 'DONE',
  WAITING_EXTERNAL: 'WAITING_EXTERNAL',
  NEEDS_USER: 'NEEDS_USER',
  SCHEDULED: 'SCHEDULED',
  RETRY: 'RETRY',
  FAILED: 'FAILED',
  DEAD_LETTER: 'DEAD_LETTER',
});

export { STATE };

export function scoreJob(job, now = Date.now()) {
  const priority = priorityScore(job.priority);
  const deadline = deadlineScore(job.deadlineAt, now);
  const value = finite(job.expectedValue, 0);
  const leverage = finite(job.unblockLeverage, 0);
  const userTime = finite(job.userMinutesAvoided, 0);
  const cost = finite(job.estimatedCostUsd, 0);
  const risk = finite(job.riskScore, 0);

  return (priority * 1000) + (deadline * 100) + (value * 2) + (leverage * 20) + userTime - (cost * 10) - (risk * 25);
}

export function selectReadyJobs(jobs, { maxWip = 3, now = Date.now() } = {}) {
  return jobs
    .filter((job) => job.state === STATE.READY)
    .map((job) => ({ job, score: scoreJob(job, now) }))
    .sort((a, b) => b.score - a.score || String(a.job.id).localeCompare(String(b.job.id)))
    .slice(0, maxWip)
    .map(({ job }) => job);
}

function priorityScore(priority) {
  if (priority === 'P0') return 5;
  if (priority === 'P1') return 4;
  if (priority === 'P2') return 3;
  if (priority === 'P3') return 2;
  return 1;
}

function deadlineScore(deadlineAt, now) {
  if (!deadlineAt) return 0;
  const ms = new Date(deadlineAt).getTime() - now;
  if (!Number.isFinite(ms)) return 0;
  if (ms <= 0) return 10;
  const hours = ms / 3_600_000;
  if (hours <= 1) return 9;
  if (hours <= 6) return 7;
  if (hours <= 24) return 5;
  if (hours <= 72) return 3;
  return 1;
}

function finite(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
