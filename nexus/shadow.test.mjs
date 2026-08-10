import assert from 'node:assert/strict';
import test from 'node:test';
import { loadNexusConfig } from './config.js';
import { authorize } from './policy.js';
import { selectReadyJobs, STATE } from './scheduler.js';
import { NexusShadowWorker } from './worker.js';
import { MemoryShadowStore } from './shadow-store.js';
import { ReadOnlyConnector } from './connectors/base.js';

test('runtime is disabled unless explicitly enabled', () => {
  assert.equal(loadNexusConfig({}).enabled, false);
});

test('reserved external actions fail closed', () => {
  const config = loadNexusConfig({ NEXUS_ENABLED: 'true' });
  assert.deepEqual(authorize('send_external_message', config), { allowed: false, reason: 'NEEDS_USER' });
  assert.deepEqual(authorize('unknown_action', config), { allowed: false, reason: 'UNKNOWN_ACTION_FAIL_CLOSED' });
});

test('scheduler favors P0 and respects WIP', () => {
  const jobs = [
    { id: 'p2', state: STATE.READY, priority: 'P2' },
    { id: 'p0', state: STATE.READY, priority: 'P0' },
    { id: 'p1', state: STATE.READY, priority: 'P1' },
  ];
  assert.deepEqual(selectReadyJobs(jobs, { maxWip: 2 }).map((j) => j.id), ['p0', 'p1']);
});

test('shadow worker advances safe internal work and blocks reserved work', async () => {
  const store = new MemoryShadowStore([
    { id: 'safe', state: STATE.READY, priority: 'P0', actionType: 'reconcile', type: 'reconcile' },
    { id: 'send', state: STATE.READY, priority: 'P0', actionType: 'send_external_message', type: 'send' },
  ]);
  const worker = new NexusShadowWorker({
    store,
    config: loadNexusConfig({ NEXUS_ENABLED: 'true', NEXUS_SHADOW: 'true' }),
    handlers: {
      reconcile: async () => ({ nextState: STATE.DONE, summary: 'reconciled in shadow mode' }),
      send: async () => { throw new Error('must never execute'); },
    },
  });

  const run = await worker.tick();
  assert.equal(run.status, 'OK');
  const jobs = await store.listJobs();
  assert.equal(jobs.find((j) => j.id === 'safe').state, STATE.DONE);
  assert.equal(jobs.find((j) => j.id === 'send').state, STATE.READY);
  assert.equal(store.events.at(0).reason, 'NEEDS_USER');
});

test('connector write path is physically blocked', async () => {
  const connector = new ReadOnlyConnector('outlook-shadow');
  await assert.rejects(() => connector.write({}), /External writes are disabled/);
});
