import { STATE } from './scheduler.js';

export class MemoryShadowStore {
  constructor(seedJobs = []) {
    this.jobs = new Map(seedJobs.map((job) => [job.id, { ...job }]));
    this.events = [];
  }

  async listJobs() {
    return [...this.jobs.values()].map((job) => ({ ...job }));
  }

  async claimJob(id, now) {
    const job = this.jobs.get(id);
    if (!job || job.state !== STATE.READY) return false;
    job.state = STATE.CLAIMED;
    job.claimedAt = now.toISOString();
    return true;
  }

  async completeJob(id, update) {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Unknown job ${id}`);
    Object.assign(job, update);
  }

  async failJob(id, update) {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Unknown job ${id}`);
    Object.assign(job, update, { state: STATE.FAILED });
  }

  async recordEvent(event) {
    this.events.push({ ...event });
  }

  async recoverExpiredLeases() {}
  async promoteSatisfiedDependencies() {}
}
