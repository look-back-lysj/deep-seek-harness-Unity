/** Read-only production imports; fake official services; all real file writes remain here. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MarketRuntime } from '../../../packages/market-core/src/host/market-runtime.ts';
import { AiAssistant } from '../../../packages/market-core/src/host/ai-assist.ts';
import { OfficialHostPort } from '../../../packages/market-core/src/adapters/dsh/host-port.ts';
import { CatalogArtifactPort } from '../../../packages/market-core/src/adapters/dsh/artifact-adapter.ts';
import { AtomicProfileLocks, NodePersistenceFiles } from '../../../packages/market-core/src/adapters/dsh/persistence-adapter.ts';
import { JsonTaskStore } from '../../../packages/market-core/src/persistence/task-store.ts';
import { createPlanBundle } from '../../../packages/market-core/src/core/planner.ts';
import { sha256Hex } from '../../../packages/market-core/src/core/canonical.ts';
import { InstallTaskManager } from '../../../packages/market-core/src/core/task-manager.ts';

if (!process.env.MARKET_REVIEW_OUTPUT) throw new Error('Use run.mjs with an explicit MARKET_REVIEW_OUTPUT');
const root = join(process.env.MARKET_REVIEW_OUTPUT!, `probe-run-${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${process.pid}`);
mkdirSync(root, { recursive: false });
globalThis.fetch = async () => { throw new Error('Network forbidden in this review'); };
const observations: any[] = [];
const env = 'synthetic-review-only';
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function gate() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function waitUntil(check: () => Promise<any> | any, label = 'condition') {
  const end = Date.now() + 6000;
  while (Date.now() < end) { const result = await check(); if (result) return result; await delay(5); }
  throw new Error(`Timeout: ${label}`);
}
function item(name: string, version: string, enabled = true) {
  return { packageName: name, version, installed: true, bundleEnabled: enabled, source: 'market-cache-file', removable: true, rows: [], restartRequired: false };
}
function inventory(items: any[]) { return { environmentId: env, revision: 'synthetic', items: structuredClone(items), unknownItems: [] }; }
class Store {
  records = new Map<string, any>();
  async get(id: string) { const x = this.records.get(id); return x && structuredClone(x); }
  async getByPlan(environmentId: string, id: string) { return [...this.records.values()].find(x => x.task.environmentId === environmentId && x.task.planId === id); }
  async put(record: any) { this.records.set(record.task.taskId, structuredClone(record)); }
  async list(environmentId: string) { return [...this.records.values()].filter(x => x.task.environmentId === environmentId).map(x => structuredClone(x)); }
}
class Host {
  items: any[] = [];
  calls: any[] = [];
  cancelCalls: string[] = [];
  hook?: (request: any) => Promise<any>;
  async readState() { return { inventory: inventory(this.items), sessionRevision: 'same-process', activeRequests: [], activity: { stable: true, unknownSharedImpact: false } }; }
  async install(request: any) {
    this.calls.push(structuredClone(request));
    if (this.hook) return this.hook(request);
    this.items = [...this.items.filter(x => x.packageName !== request.artifact.packageName), item(request.artifact.packageName, request.artifact.version, request.enabled)];
    return { kind: 'applied', changed: true, restartRequired: false, permissionChanges: [] };
  }
  async cancel(requestId: string) { this.cancelCalls.push(requestId); return { kind: 'too-late' as const }; }
}
const artifacts = {
  async acquire(request: any) { return { ...request, localRef: join(root, `${request.pluginId}.synthetic.tgz`), size: 1 }; },
  async release() {},
};
async function bundle(names: string[], baseline: any[] = [], edges: any[] = []) {
  const plugins = names.map((name, i) => ({ pluginId: `p${i}`, packageName: name, version: '2.0.0', artifactDigest: 'a'.repeat(64), verification: 'verified' as const, requiresRestart: false, installable: true }));
  const context = {
    catalogRevision: 'catalog-approved', environmentId: env, hostFingerprint: 'synthetic-host', inventory: baseline,
    plugins, selections: plugins.map(p => ({ pluginId: p.pluginId, packageName: p.packageName, targetVersion: p.version, targetDigest: p.artifactDigest, enabledIntent: baseline.find(x => x.packageName === p.packageName)?.bundleEnabled ?? true, tryUnverified: false })),
    now: new Date(), marketManagedPackageNames: baseline.map(x => x.packageName),
  };
  const lockBytes = new TextEncoder().encode('synthetic-review-lock');
  const result = await createPlanBundle(context as any, edges.length ? {
    packId: 'review-pack', packVersion: '1.0.0', components: plugins.map(p => ({ pluginId: p.pluginId, required: true })), lockBytes,
    execution: { schemaVersion: '1', packId: 'review-pack', packVersion: '1.0.0', lockDigest: await sha256Hex(lockBytes), coverage: 'complete', provenance: 'synthetic-only', edges },
  } : undefined);
  assert.equal(result.status, 'ready');
  return result.bundle!;
}
function managerFor(label: string, host: any, artifactPort: any = artifacts, store: any = new Store()) {
  const locks = new AtomicProfileLocks(join(root, label), 5000);
  return { manager: new InstallTaskManager({ host, artifacts: artifactPort, store, locks }), store, locks };
}
async function start(manager: any, b: any, host: any, extra: any = {}) {
  return manager.start(b, { planId: b.plan.planId, planDigest: b.plan.planDigest, confirmed: true, idempotencyKey: 'same-key', ...extra }, await host.readState());
}
async function settled(manager: any, taskId: string) {
  return waitUntil(async () => { const t = await manager.get(taskId); return t && ['completed','partial','failed','cancelled','needs-attention','awaiting-resume','awaiting-approval'].includes(t.status) ? t : undefined; }, 'task settlement');
}
function runtimeShell(properties: any) {
  // Constructor substitution avoids creating or reading any Desktop profile.
  // These are original MarketRuntime methods with explicitly injected services.
  return Object.assign(Object.create(MarketRuntime.prototype), { identity: { environmentId: env, profileName: 'synthetic', hostVersion: 'test' }, aiProposals: new Map(), recovery: Promise.resolve() }, properties) as any;
}
async function probe(id: string, run: () => Promise<any>) {
  if (process.argv[2] && !id.startsWith(process.argv[2])) return;
  try { const observed = await run(); observations.push({ id, status: 'reproduced', observed }); }
  catch (error) { observations.push({ id, status: 'probe-failed', error: error instanceof Error ? error.stack : String(error) }); process.exitCode = 1; }
  console.log(JSON.stringify(observations.at(-1)));
}

await probe('P01-ai-normal-confirm-blocked-and-empty-diagnostics', async () => {
  let modelInput: any;
  const assistant = new AiAssistant({ async *stream(options: any) {
    modelInput = JSON.parse(options.messages[0].content[0].text);
    yield { type: 'text-delta', text: JSON.stringify({ summary: 'synthetic', facts: [], actions: [{ kind: 'disable', packageName: 'fixture', reason: 'synthetic' }] }) };
    yield { type: 'finish', reason: { kind: 'stop' } };
  } }, { currentSelection: () => ({ provider: 'fake', model: 'fake' }) });
  const runtime = runtimeShell({ assistant });
  const analyzed = await runtime.aiAnalyze({ taskId: 'failed-task-with-errors' });
  assert.equal(analyzed.status, 'ready');
  const confirmation = await runtime.aiConfirm({ proposalId: analyzed.proposal.id, impactDigest: analyzed.proposal.impactDigest, idempotencyKey: 'once', confirmed: true });
  assert.equal(confirmation.status, 'blocked');
  assert.equal(runtime.aiProposals.size, 0);
  assert.deepEqual(modelInput.diagnostics, []);
  return { analyzed: analyzed.status, storedProposals: runtime.aiProposals.size, confirmation, sentDiagnostics: modelInput.diagnostics };
});

await probe('P02-latent-ai-write-boundaries-after-controlled-proposal-injection', async () => {
  const calls: string[] = [];
  const assistant = new AiAssistant({ async *stream() {
    yield { type: 'text-delta', text: JSON.stringify({ summary: 'synthetic', confirmed: true, actions: [
      { kind: 'remove', packageName: '@dsh-eac/market', reason: 'synthetic', command: 'unknown-field-must-be-rejected' },
      { kind: 'disable', packageName: 'second-action', reason: 'synthetic' },
    ] }) };
    yield { type: 'finish', reason: { kind: 'stop' } };
  } }, { currentSelection: () => ({ provider: 'fake', model: 'fake' }) });
  const runtime = runtimeShell({ assistant, host: { async remove(name: string) { calls.push(name); return { application: 'applied', changed: true }; } } });
  const analysis = await runtime.aiAnalyze({});
  assert.equal(analysis.status, 'ready');
  runtime.aiProposals.set(analysis.proposal.id, analysis.proposal);
  const request = { proposalId: analysis.proposal.id, impactDigest: analysis.proposal.impactDigest, confirmed: true, riskConfirmed: true, idempotencyKey: 'identical-confirmation' };
  const first = await runtime.aiConfirm(request);
  const second = await runtime.aiConfirm(request);
  assert.deepEqual(calls, ['@dsh-eac/market', '@dsh-eac/market']);
  return { evidence: 'controlled injection only; normal flow currently blocked by P01', acceptedUnknownFields: true, displayedActionCount: analysis.proposal.actions.length, calls, first, second };
});

await probe('P03-official-host-source-evidence-missing-blocks-upgrade', async () => {
  const host = new OfficialHostPort({ profileContext: { dir: join(root, 'empty-profile') }, get: () => ({
    async listBundles() { return [{ name: 'market-installed-package', version: '1.0.0', installed: true, enabled: true, removable: true, rows: [] }]; },
    async listPlugins() { return []; },
  }) } as any, env);
  const state = await host.readState();
  const runtime = runtimeShell({ host, files: { async writeAtomic() {} }, catalog: { load: () => ({ snapshot: { revision: 'new-catalog', plugins: [{ id: 'p0', packageName: 'market-installed-package', version: '2.0.0', artifactDigest: 'a'.repeat(64), verification: 'verified', requiresRestart: false, installability: 'bundle-installable' }] } }) } });
  const result = await runtime.planCreate({ selections: [{ pluginId: 'p0', packageName: 'market-installed-package', targetVersion: '2.0.0', targetDigest: 'a'.repeat(64), enabledIntent: true, tryUnverified: false }] });
  assert.equal(state.inventory.items[0].source, 'unknown');
  assert.equal(result.plan.items[0].action, 'blocked');
  return { source: state.inventory.items[0].source, action: result.plan.items[0].action, blockers: result.plan.items[0].blockers };
});

await probe('P04-approved-source-reference-is-ignored', async () => {
  const selectedSources: any[] = [];
  let delivery: any = { pluginId: 'p0', packageName: 'fixture', version: '2.0.0', artifactDigest: 'a'.repeat(64), sources: [{ ref: 'https://approved.invalid/package.tgz', kind: 'https-artifact', priority: 0 }] };
  const port = new CatalogArtifactPort({ async download(d: any) { selectedSources.push(d.sources); return { localPath: join(root, 'synthetic.tgz'), verified: { size: 1 } }; } } as any, () => [delivery]);
  const approvedRequest = { requestId: 'request', pluginId: 'p0', packageName: 'fixture', version: '2.0.0', artifactDigest: 'a'.repeat(64), sourceRef: 'catalog:catalog-approved:p0' };
  delivery = { ...delivery, sources: [{ ref: 'https://unconfirmed.invalid/new.tgz', kind: 'https-artifact', priority: 0 }] };
  await port.acquire(approvedRequest);
  assert.equal(selectedSources[0][0].ref, 'https://unconfirmed.invalid/new.tgz');
  return { approvedSourceRef: approvedRequest.sourceRef, usedSources: selectedSources[0], networkRequests: 0, digestCheckBypassed: false };
});

await probe('P05-restart-required-prerequisite-does-not-block-consumer', async () => {
  let version = '1.0.0';
  const calls: string[] = [];
  let consumerInstalled = false;
  const official = {
    async listBundles() { return [
      { name: 'prerequisite', version, installed: true, enabled: true, removable: true, rows: [{ rowId: 'r0', moduleName: 'prerequisite-module', entryId: 'old-running-entry' }] },
      ...(consumerInstalled ? [{ name: 'consumer', version: '2.0.0', installed: true, enabled: true, removable: true, rows: [] }] : []),
    ]; },
    async listPlugins() { return [{ entryId: 'old-running-entry', moduleName: 'prerequisite-module', enabled: true, fiberPhase: 'active' }]; },
    async installBundle(path: string) {
      const name = path.includes('p0') ? 'prerequisite' : 'consumer'; calls.push(name);
      if (name === 'prerequisite') { version = '2.0.0'; return { application: 'restart-required', changed: true, bundle: name }; }
      consumerInstalled = true; return { application: 'applied', changed: true, bundle: name };
    },
  };
  const host = new OfficialHostPort({ profileContext: { dir: join(root, 'empty-profile') }, get: () => official } as any, env);
  const b = await bundle(['prerequisite', 'consumer'], [item('prerequisite', '1.0.0')], [{ prerequisiteId: 'p0', consumerId: 'p1', milestone: 'active' }]);
  const { manager } = managerFor('restart', host);
  const started = await start(manager, b, host);
  const task = await settled(manager, started.task.taskId);
  assert.deepEqual(calls, ['prerequisite', 'consumer']);
  assert.equal(task.items[0].status, 'restart-required');
  assert.equal(task.items[1].status, 'enabled');
  return { calls, items: task.items.map((x: any) => ({ name: x.packageName, status: x.status })), officialRuntimeEntryStill: 'old-running-entry', inventoryRestartRequired: (await host.readState()).inventory.items[0].restartRequired };
});

await probe('P06-production-lock-cancel-during-download-still-installs', async () => {
  const host = new Host(); const acquired = gate(); const release = gate(); let first = true;
  const artifactPort = { ...artifacts, async acquire(request: any) { if (first) { first = false; acquired.resolve(); await release.promise; } return artifacts.acquire(request); } };
  const { manager, store } = managerFor('cancel-download', host, artifactPort);
  const started = await start(manager, await bundle(['a', 'b']), host);
  await acquired.promise;
  let returned = false;
  const cancellation = manager.cancel({ taskId: started.task.taskId, idempotencyKey: 'cancel' }).then(x => { returned = true; return x; });
  await delay(30);
  const beforeRelease = { cancellationReturned: returned, cancellationPersisted: (await store.get(started.task.taskId)).cancellationRequested };
  release.resolve();
  const result = await cancellation;
  assert.deepEqual(host.calls.map(x => x.artifact.packageName), ['a', 'b']);
  assert.equal(result.status, 'completed');
  return { beforeRelease, officialCancelCalls: host.cancelCalls, installed: host.calls.map(x => x.artifact.packageName), cancellationResult: result.status };
});

await probe('P07-production-lock-cancel-install-still-runs-next-item', async () => {
  const host = new Host(); const installing = gate(); const release = gate();
  host.hook = async request => {
    if (request.artifact.packageName === 'a') { installing.resolve(); await release.promise; return { kind: 'cancelled', changed: false, permissionChanges: [] }; }
    host.items.push(item('b', '2.0.0')); return { kind: 'applied', changed: true, restartRequired: false, permissionChanges: [] };
  };
  host.cancel = async requestId => { host.cancelCalls.push(requestId); release.resolve(); return { kind: 'cancelled' as any }; };
  const { manager } = managerFor('cancel-install', host);
  const started = await start(manager, await bundle(['a', 'b']), host);
  await installing.promise;
  const result = await manager.cancel({ taskId: started.task.taskId, idempotencyKey: 'cancel' });
  assert.deepEqual(host.calls.map(x => x.artifact.packageName), ['a', 'b']);
  assert.equal(result.status, 'partial');
  return { calls: host.calls.map(x => x.artifact.packageName), cancellationResult: result.status, items: result.items.map(x => x.status) };
});

await probe('P08-interrupted-result-unknown-is-replayed-after-resume', async () => {
  const b = await bundle(['recovery']); const store = new Store(); const host = new Host();
  host.items = [item('recovery', '2.0.0')];
  const taskId = 'synthetic-interrupted'; const artifact = await artifacts.acquire({ pluginId: 'p0', packageName: 'recovery', version: '2.0.0', artifactDigest: 'a'.repeat(64) });
  await store.put({ task: { taskId, planId: b.plan.planId, planDigest: b.plan.planDigest, environmentId: env, status: 'installing', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), items: [{ pluginId: 'p0', packageName: 'recovery', targetVersion: '2.0.0', status: 'installing', changed: false, installOutcome: 'unknown', permissionChanges: [] }], events: [], nextAction: 'installing' }, bundle: b, baseline: inventory([]), itemFacts: { p0: { installed: false, active: false } }, attempts: [{ id: 'attempt-1', requestId: 'old-request-with-missing-receipt', pluginId: 'p0', phase: 'installing', artifact }], idempotency: { start: 'start' }, approvalIdempotency: {}, resumeIdempotency: {}, activeRequestId: 'old-request-with-missing-receipt', attemptCounter: 1, nextSequence: 0, cancellationRequested: false, eventLogTruncated: false });
  const { manager } = managerFor('interrupted', host, artifacts, store);
  await manager.reconcileInterrupted(env);
  const pending = (await manager.get(taskId))!;
  assert.ok(pending.resume);
  await manager.resume({ taskId, challengeId: pending.resume!.id, resumeDigest: pending.resume!.digest, idempotencyKey: 'resume' });
  const task = await settled(manager, taskId);
  assert.equal(host.calls.length, 1);
  assert.equal(host.calls[0].requestId, 'old-request-with-missing-receipt');
  return { onDiskBeforeResume: '2.0.0', remaining: pending.resume!.remainingPluginIds, replayedRequestId: host.calls[0].requestId, status: task.status };
});

await probe('P09-active-equivalent-new-plan-not-deduplicated-and-retry-link-lost', async () => {
  const host = new Host();
  host.hook = async request => {
    if (host.calls.length === 1) return { kind: 'awaiting-approval', attemptId: 'official-one', pendingBuilds: ['synthetic-build'], pendingBuildsDigest: await sha256Hex('["synthetic-build"]'), permissionChanges: [] };
    host.items.push(item(request.artifact.packageName, '2.0.0')); return { kind: 'applied', changed: true, restartRequired: false, permissionChanges: [] };
  };
  const { manager, store } = managerFor('dedupe', host);
  const firstBundle = await bundle(['same-intent']);
  const first = await start(manager, firstBundle, host);
  await settled(manager, first.task.taskId);
  const samePlan = await start(manager, firstBundle, host);
  assert.equal(samePlan.created, false);
  const nextBundle = await bundle(['same-intent']);
  const second = await start(manager, nextBundle, host, { retryOfTaskId: first.task.taskId });
  const secondTask = await settled(manager, second.task.taskId);
  assert.equal(second.created, true);
  assert.equal(store.records.size, 2);
  assert.equal(host.calls.length, 2);
  assert.equal(secondTask.retryOfTaskId, undefined);
  return { samePlanCreatedAgain: samePlan.created, equivalentNewPlanCreated: second.created, firstStatus: (await manager.get(first.task.taskId))!.status, secondStatus: secondTask.status, installCalls: host.calls.length, persistedRetryLink: secondTask.retryOfTaskId ?? null };
});

await probe('P10-drift-during-acquisition-overwrites-new-external-version', async () => {
  const host = new Host(); host.items = [item('drifted', '1.0.0', false)];
  const entered = gate(); const release = gate();
  const artifactPort = { ...artifacts, async acquire(request: any) { entered.resolve(); await release.promise; return artifacts.acquire(request); } };
  const { manager } = managerFor('drift', host, artifactPort);
  const started = await start(manager, await bundle(['drifted'], host.items), host);
  await entered.promise;
  host.items = [{ ...item('drifted', '9.0.0', true), source: 'unknown', localIdentity: 'fork' }];
  release.resolve();
  const task = await settled(manager, started.task.taskId);
  assert.equal(host.calls.length, 1);
  assert.equal(host.items[0].version, '2.0.0');
  return { planBaseline: '1.0.0 disabled', externalChangeDuringAcquire: '9.0.0 enabled local fork', afterInstall: host.items[0], status: task.status };
});

await probe('P11-enable-remove-ignore-expected-version-idempotency-and-writer', async () => {
  const calls: any[] = [];
  const runtime = runtimeShell({ host: {
    async setEnabled(name: string, enabled: boolean) { calls.push({ action: 'enable', name, enabled }); return { kind: 'failed', changed: false, error: 'official-failure', errorCode: 'meaningful-code', diagnostic: 'meaningful-diagnostic', permissionChanges: [] }; },
    async remove(name: string) { calls.push({ action: 'remove', name }); return { application: 'applied', changed: true }; },
  }, tasks: { start() { throw new Error('must enter shared executor'); } } });
  const failed = await runtime.pluginSetEnabled({ packageName: 'unverified-target', expectedVersion: 'old', enabled: false, idempotencyKey: 'repeated' });
  const request = { packageName: 'unverified-target', expectedVersion: 'old', confirmed: true, idempotencyKey: 'repeated' };
  await runtime.pluginRemove(request); await runtime.pluginRemove(request);
  assert.equal(calls.filter(x => x.action === 'remove').length, 2);
  assert.equal(failed.errorCode, undefined); assert.equal(failed.diagnostic, undefined);
  return { calls, droppedDiagnostic: failed, executorCalled: false };
});

await probe('P12-json-store-unindexed-summary-invisible-after-second-write-failure', async () => {
  const priorObservationStore = new Store();
  const host = new Host();
  const { manager } = managerFor('record-template', host, artifacts, priorObservationStore);
  const started = await start(manager, await bundle(['store-fixture']), host);
  await settled(manager, started.task.taskId);
  const record = await priorObservationStore.get(started.task.taskId);
  const files = new NodePersistenceFiles(join(root, 'store-write-failure'));
  const faulty = { read: files.read.bind(files), list: files.list.bind(files), append: files.append.bind(files), remove: files.remove.bind(files), size: files.size.bind(files),
    async writeAtomic(path: string, data: Uint8Array) { if (path === 'task-index.json') throw new Error('injected interruption after summary before index'); await files.writeAtomic(path, data); } };
  const locks = new AtomicProfileLocks(join(root, 'store-locks'), 5000);
  const brokenStore = new JsonTaskStore(faulty, locks);
  await assert.rejects(brokenStore.put(record), /injected interruption/);
  const recoveredStore = new JsonTaskStore(files, locks);
  const listed = await recoveredStore.list(env);
  assert.ok(await recoveredStore.get(record.task.taskId)); assert.equal(listed.length, 0);
  return { summaryReadableById: true, listCountAfterRecreation: listed.length, claim: 'history/recovery visibility gap; not proof of duplicate real installation' };
});

writeFileSync(join(root, 'observations.json'), JSON.stringify({ evidenceLevel: 'synthetic services + current production classes; no UI/network/real model/profile', root, observations }, null, 2), { flag: 'wx' });
console.log(`EVIDENCE=${root}`);
