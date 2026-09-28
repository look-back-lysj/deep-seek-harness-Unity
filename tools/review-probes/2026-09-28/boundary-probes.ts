import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { CatalogRepository } from '../../../packages/market/src/catalog/store.ts';
import { validateMarketIndex } from '../../../packages/market/src/catalog/validate.ts';
import { OfficialHostPort } from '../../../packages/market/src/adapters/dsh/host-port.ts';
import { AtomicProfileLocks, NodePersistenceFiles } from '../../../packages/market/src/adapters/dsh/persistence-adapter.ts';
import { JsonTaskStore } from '../../../packages/market/src/persistence/task-store.ts';
import { SegmentedEventLog } from '../../../packages/market/src/persistence/event-log.ts';
import { createPlanBundle } from '../../../packages/market/src/core/planner.ts';
import { InstallTaskManager } from '../../../packages/market/src/core/task-manager.ts';

if (!process.env.MARKET_REVIEW_OUTPUT) throw new Error('Use run.mjs with an explicit MARKET_REVIEW_OUTPUT');
const root = join(process.env.MARKET_REVIEW_OUTPUT!, `boundary-run-${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${process.pid}`);
mkdirSync(root);
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const observations: any[] = [];
async function probe(id: string, run: () => Promise<any>) {
  if (process.argv[2] && !id.startsWith(process.argv[2])) return;
  try { observations.push({ id, status: 'reproduced', observed: await run() }); }
  catch (error) { observations.push({ id, status: 'probe-failed', error: String(error) }); process.exitCode = 1; }
  console.log(JSON.stringify(observations.at(-1)));
}
await probe('P13-valid-evidence-rejected-with-host-constructor-defaults', async () => {
  const original = JSON.parse(readFileSync(join(process.cwd(), 'tests/catalog/fixtures/valid-market-index.json'), 'utf8'));
  const verified = structuredClone(original); verified.plugins[0].verification = 'verified';
  const evidence = {
    $schema: 'https://mojobox.dev/schemas/evidence-v1alpha1.json', apiVersion: 'evidence.mojobox.dev/v1alpha1', kind: 'Evidence',
    subject: { id: 'dev.test.alpha', version: '1.2.3', artifactDigest: 'sha256:' + 'a'.repeat(64) },
    manifestDigest: verified.plugins[0].manifestDigest,
    specifications: { dshStdRevision: '1234567890abcdef1234567890abcdef12345678' },
    suite: { id: 'suite', version: '1.0.0', digest: 'sha256:' + 'b'.repeat(64) }, issuer: 'synthetic-review',
    hostDescriptorDigest: 'sha256:' + 'c'.repeat(64),
    host: { id: 'host-test', name: 'Test Host', version: '1.0.0', adapterVersion: '1.0.0', dshVersion: '0.1.7-rc.2', runtime: 'node24' },
    evidenceLevel: 'Tested', result: 'pass', checks: [{ id: 'install', result: 'pass' }],
    testedAt: '2026-09-27T00:00:00.000Z', expiresAt: '2026-12-01T00:00:00.000Z', revoked: false,
  };
  const bytes = Buffer.from(JSON.stringify(evidence));
  verified.plugins[0].evidence = [{ contentBase64: bytes.toString('base64'), sha256: 'sha256:' + createHash('sha256').update(bytes).digest('hex') }];
  validateMarketIndex(verified, { host: { id: 'host-test', dshVersion: '0.1.7-rc.2', runtime: 'node24' }, now: new Date('2026-09-28T00:00:00Z') });
  const repository = new CatalogRepository(original, join(root, 'catalog'));
  const result = await repository.refresh(async () => JSON.stringify(verified));
  assert.equal(result.status, 'failed');
  assert.match(result.reason!, /没有当前宿主证据上下文/);
  return { passesWithExplicitHostEvidence: true, sameConstructorDefaultsAsMarketRuntime: true, refreshStatus: result.status, reason: result.reason, retainedRevision: result.current.snapshot.revision };
});

await probe('P14-inventory-read-failure-does-not-prevent-install-write', async () => {
  const env = 'incomplete-inventory'; const calls: any[] = [];
  const host = new OfficialHostPort({ profileContext: { dir: join(root, 'empty-profile') }, get: () => ({
    async listBundles() { throw new Error('synthetic inventory unavailable'); },
    async listPlugins() { return []; },
    async installBundle(spec: string) { calls.push(spec); return { application: 'failed', changed: false, error: { code: 'operation-error', diagnostic: 'synthetic stop after observing write entry' } }; },
  }) } as any, env);
  const baseline = await host.readState();
  assert.equal(baseline.activity.stable, true); assert.equal(baseline.inventory.unknownItems.length, 1);
  const prepared = await createPlanBundle({ catalogRevision: 'synthetic', environmentId: env, hostFingerprint: 'synthetic', inventory: baseline.inventory.items,
    plugins: [{ pluginId: 'p0', packageName: 'unknown-installed-state', version: '1.0.0', artifactDigest: 'a'.repeat(64), verification: 'unknown', requiresRestart: false, installable: true }],
    selections: [{ pluginId: 'p0', packageName: 'unknown-installed-state', targetVersion: '1.0.0', targetDigest: 'a'.repeat(64), enabledIntent: true, tryUnverified: true }], now: new Date(),
  });
  const b = prepared.bundle!; assert.ok(b);
  const files = new NodePersistenceFiles(join(root, 'task-state')); const locks = new AtomicProfileLocks(join(root, 'task-locks'), 5000);
  const store = new JsonTaskStore(files, locks); const events = new SegmentedEventLog(files);
  const manager = new InstallTaskManager({ host, store, locks, events, artifacts: {
    async acquire(request: any) { return { ...request, localRef: join(root, 'synthetic.tgz'), size: 1 }; }, async release() {},
  } });
  const trace: string[] = [];
  const originalRunner = (manager as any).runTaskLocked.bind(manager);
  (manager as any).runTaskLocked = async (record: any) => {
    try { return await originalRunner(record); }
    catch (error) { trace.push(error instanceof Error ? error.stack! : String(error)); throw error; }
  };
  const started = await manager.start(b, { planId: b.plan.planId, planDigest: b.plan.planDigest, idempotencyKey: 'one', confirmed: true }, baseline);
  const end = Date.now() + 5000; let task;
  while (Date.now() < end) { task = await manager.get(started.task.taskId); if (task?.status === 'failed' || task?.status === 'needs-attention') break; await new Promise(resolve => setTimeout(resolve, 5)); }
  if (calls.length !== 1) console.log(JSON.stringify({ probe: 'P14-debug', trace, persistedTask: task }));
  assert.equal(calls.length, 1);
  return { readErrors: baseline.inventory.unknownItems, reportedStable: baseline.activity.stable, officialInstallCalls: calls.length, finalStatus: task?.status };
});
writeFileSync(join(root, 'observations.json'), JSON.stringify({ root, observations, evidenceLevel: 'synthetic services plus current production classes' }, null, 2), { flag: 'wx' });
console.log(`EVIDENCE=${root}`);
