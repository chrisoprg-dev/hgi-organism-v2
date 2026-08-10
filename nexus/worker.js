import { loadNexusConfig } from './config.js';
import { authorize } from './policy.js';
import { selectReadyJobs, STATE } from './scheduler.js';

export class NexusShadowWorker {
  constructor({ store, handlers = {}, config = loadNexusConfig(), clock = () => new Date() }) {
    if (!store) throw new Error('store is required');
    this.store = store;
    this.handlers = handlers;
    this.config = config;
    this.clock = clock;
  }

  async tick() {
    const now = this.clock();
    const run = {
      startedAt: now.toISOString(),
      enabled: this.config.enabled,
      shadow: this.config.shadow,
      claimed: [],
      outcomes: [],
    };

    if (!this.config.enabled) {
      run.status = 'DISABLED';
      return run;
    }

    await this.store.recoverExpiredLeases?.(now);
    await this.store.promoteSatisfiedDependencies?.(now);

    const jobs = await this.store.listJobs();
    const selected = selectReadyJobs(jobs, { maxWip: this.config.maxWip, now: now.getTime() });

    for (const job of selected) {
      const auth = authorize(job.actionType, this.config);
      if (!auth.allowed) {
        await this.store.recordEvent?.({
          type: 'policy_block',
          jobId: job.id,
          actionType: job.actionType,
          reason: auth.reason,
          eventTime: now.toISOString(),
        });
        run.outcomes.push({ jobId: job.id, state: auth.reason === 'NEEDS_USER' ? STATE.NEEDS_USER : STATE.FAILED, reason: auth.reason });
        continue;
      }

      const claimed = await this.store.claimJob(job.id, now);
      if (!claimed) continue;
      run.claimed.push(job.id);

      try {
        const handler = this.handlers[job.type];
        if (!handler) throw new Error(`No handler registered for ${job.type}`);

        const result = await handler({ job, shadow: true, now });
        const nextState = normalizeNextState(result?.nextState);
        await this.store.completeJob(job.id, {
          state: nextState,
          result: sanitizeResult(result),
          completedAt: this.clock().toISOString(),
        });
        run.outcomes.push({ jobId: job.id, state: nextState });
      } catch (error) {
        await this.store.failJob(job.id, {
          errorCode: safeErrorCode(error),
          failedAt: this.clock().toISOString(),
        });
        run.outcomes.push({ jobId: job.id, state: STATE.FAILED, reason: safeErrorCode(error) });
      }
    }

    run.status = 'OK';
    return run;
  }
}

function normalizeNextState(state) {
  const allowed = new Set([
    STATE.DONE,
    STATE.WAITING_EXTERNAL,
    STATE.NEEDS_USER,
    STATE.SCHEDULED,
    STATE.RETRY,
  ]);
  return allowed.has(state) ? state : STATE.DONE;
}

function sanitizeResult(result) {
  if (!result || typeof result !== 'object') return {};
  const { nextState, summary, evidenceIds, metrics } = result;
  return {
    summary: typeof summary === 'string' ? summary.slice(0, 2000) : undefined,
    evidenceIds: Array.isArray(evidenceIds) ? evidenceIds.slice(0, 50).map(String) : undefined,
    metrics: metrics && typeof metrics === 'object' ? metrics : undefined,
    nextState,
  };
}

function safeErrorCode(error) {
  const name = error?.name || 'Error';
  const code = error?.code || 'UNHANDLED';
  return `${name}:${code}`.slice(0, 160);
}
