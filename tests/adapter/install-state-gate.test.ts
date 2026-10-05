import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OfficialHostPort } from '../../packages/market-core/src/adapters/dsh/host-port.ts'
import { InstallTaskManager } from '../../packages/market-core/src/core/task-manager.ts'
import { createPlanBundle } from '../../packages/market-core/src/core/planner.ts'
import { InMemoryLocks, InMemoryTaskStore, waitForTask } from '../core/helpers.ts'
import type { HostInstallRequest } from '../../packages/market-core/src/core/ports.ts'
import type { InstallLogEntry } from '../../packages/market-core/src/contracts/types.ts'

const packageName = '@test/plugin'

function bundle(name = packageName, fields: Record<string, unknown> = {}) {
  return { name, version: '1.0.0', installed: true, enabled: true, removable: true, rows: [], ...fields }
}

async function fixture(bundles: unknown[] = []) {
  const output = process.env.EAC_TEST_OUTPUT ?? join(tmpdir(), 'eac-market-tests')
  mkdirSync(output, { recursive: true })
  const root = mkdtempSync(join(output, 'install-state-gate-'))
  const localRef = join(root, 'artifact.tgz')
  const bytes = Buffer.from('synthetic install-state gate artifact')
  await writeFile(localRef, bytes)
  await writeFile(join(root, 'package.json'), '{}')
  let installed = false
  const manager = {
    listBundles: vi.fn(async (): Promise<unknown> => installed
      ? [...bundles.filter(item => (item as { name?: string } | null)?.name !== packageName), bundle()]
      : bundles),
    listPlugins: vi.fn(async () => []),
    installBundle: vi.fn(async (path: string) => {
      installed = true
      await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { [packageName]: 'file:' + path } }))
      return { application: 'applied', changed: true, target: packageName, stage: 'install' }
    }),
    setBundleEnabled: vi.fn(async () => ({ application: 'applied', changed: true })),
    removeBundle: vi.fn(async () => ({ application: 'applied', changed: true })),
  }
  const context = { profileContext: { dir: root }, get: (key: string) => key === 'pluginManager' ? manager : undefined } as never
  const request: HostInstallRequest = {
    requestId: 'gate-request', enabled: true,
    artifact: { pluginId: 'p0', packageName, version: '1.0.0', localRef, size: bytes.length, artifactDigest: createHash('sha256').update(bytes).digest('hex') },
  }
  const entries: Omit<InstallLogEntry, 'hostVersion'>[] = []
  const installLog = { append: (entry: Omit<InstallLogEntry, 'hostVersion'>) => { entries.push(entry) } }
  return { root, manager, request, entries, port: new OfficialHostPort(context, 'env-test', undefined, undefined, installLog) }
}

function expectNoOfficialWrites(manager: Awaited<ReturnType<typeof fixture>>['manager']) {
  expect(manager.installBundle).not.toHaveBeenCalled()
  expect(manager.setBundleEnabled).not.toHaveBeenCalled()
  expect(manager.removeBundle).not.toHaveBeenCalled()
}

async function startOfficialTask(current: Awaited<ReturnType<typeof fixture>>) {
  const artifact = current.request.artifact
  const now = new Date('2026-09-27T00:00:01.000Z')
  const delivery = {
    pluginId: artifact.pluginId, packageName, version: artifact.version, artifactDigest: artifact.artifactDigest,
    sources: [{ kind: 'https-artifact' as const, ref: 'https://synthetic.invalid/artifact.tgz', priority: 0 }],
  }
  const prepared = await createPlanBundle({
    environmentId: 'env-test', hostFingerprint: 'host-test', catalogRevision: 'gate-test', inventory: [], now,
    plugins: [{ ...delivery, delivery, verification: 'verified', installable: true, requiresRestart: false }],
    selections: [{ pluginId: artifact.pluginId, packageName, targetVersion: artifact.version,
      targetDigest: artifact.artifactDigest, enabledIntent: true, tryUnverified: false }],
  })
  if (prepared.status !== 'ready' || prepared.bundle === undefined) throw new Error('synthetic plan not ready')
  const artifacts = { acquire: vi.fn(async () => artifact), release: vi.fn(async () => undefined) }
  const install = vi.spyOn(current.port, 'install')
  const taskManager = new InstallTaskManager({
    host: current.port, artifacts, store: new InMemoryTaskStore(), locks: new InMemoryLocks(), now: () => now,
  })
  const started = await taskManager.start(prepared.bundle, {
    planId: prepared.bundle.plan.planId, planDigest: prepared.bundle.plan.planDigest,
    idempotencyKey: 'official-inventory-safety-start', confirmed: true,
  }, await current.port.readState())
  const task = await waitForTask(taskManager, started.task.taskId, state =>
    ['cancelled', 'completed', 'needs-attention', 'failed'].includes(state.status))
  return { task, install, artifacts }
}

describe('HC-1 official HostPort pre-install inventory gate', () => {
  it.each([
    ['unknown version', [bundle(packageName, { version: undefined })], `bundle-version:${packageName}`],
    ['duplicate identity', [bundle(), bundle()], `bundle-entry:duplicate:${packageName}`],
    ['conflicting duplicate identity', [bundle(packageName, { version: '9.0.0' }), bundle()], `bundle-entry:duplicate:${packageName}`],
    ['reversed conflicting duplicate identity', [bundle(), bundle(packageName, { version: '9.0.0' })], `bundle-entry:duplicate:${packageName}`],
    ['invalid bundle flags', [bundle(packageName, { enabled: undefined })], `bundle:${packageName}:invalid-installed-enabled-removable`],
    ['invalid rows', [bundle(packageName, { rows: {} })], `bundle:${packageName}:invalid-rows`],
    ['invalid row identity', [bundle(packageName, { rows: [{}] })], `bundle:${packageName}:invalid-row-identity`],
    ['management error', [bundle(packageName, { error: { code: 'future-error' } })], `bundle:${packageName}:unverified-management-error`],
    ['invalid management error', [bundle(packageName, { error: {} })], `bundle:${packageName}:invalid-management-error`],
    ['invalid overrides', [bundle(packageName, { overrides: {} })], `bundle:${packageName}:invalid-overrides`],
  ] as const)('rejects target %s before any official write', async (_label, bundles, diagnostic) => {
    const current = await fixture([...bundles])
    const state = await current.port.readState()
    expect(state.inventory.unknownItems).toContain(diagnostic)
    expect(state.activity.writeBarrier).toBe(false)
    expect(await current.port.install(current.request)).toMatchObject({ kind: 'unknown', errorCode: 'adapter/state-unknown', permissionChanges: [] })
    expectNoOfficialWrites(current.manager)
  })

  it.each([
    ['unavailable', 'listBundles:unavailable'],
    ['throws', 'listBundles:synthetic read failure'],
    ['null result', 'listBundles:invalid:object'],
    ['object result', 'listBundles:invalid:object'],
    ['missing bundle name', 'bundle-entry:missing-name'],
  ])('rejects global bundle uncertainty: %s', async (failure, diagnostic) => {
    const current = await fixture(failure === 'missing bundle name' ? [{ installed: true }] : [])
    if (failure === 'unavailable') Reflect.deleteProperty(current.manager, 'listBundles')
    if (failure === 'throws') current.manager.listBundles.mockRejectedValue(new Error('synthetic read failure'))
    if (failure === 'null result') current.manager.listBundles.mockResolvedValue(null)
    if (failure === 'object result') current.manager.listBundles.mockResolvedValue({})
    const state = await current.port.readState()
    expect(state.inventory.unknownItems).toContain(diagnostic)
    expect(state.activity.writeBarrier).toBe(true)
    expect(await current.port.install(current.request)).toMatchObject({ kind: 'unknown', errorCode: 'adapter/state-unknown' })
    expectNoOfficialWrites(current.manager)
  })

  it.each([
    ['@test/other', { version: undefined }],
    ['@test/plugin-extra', { version: undefined }],
    ['@test/plugin-extra', { error: { code: 'future-error' } }],
    ['@test/plugin-extra', { rows: {} }],
    ['@test/plugin-extra', {}],
  ])('does not block the target for unrelated diagnostics on %s (%j)', async (otherName, fields) => {
    const current = await fixture([bundle(otherName, fields), bundle(otherName, fields)])
    const state = await current.port.readState()
    expect(state.inventory.unknownItems).toContain(`bundle-entry:duplicate:${otherName}`)
    expect(state.activity.stable).toBe(false)
    expect(state.activity.writeBarrier).toBe(false)
    expect(await current.port.install(current.request)).toMatchObject({ kind: 'applied', changed: true })
    expect(current.manager.installBundle).toHaveBeenCalledExactlyOnceWith(current.request.artifact.localRef, {
      enabled: true, requestId: current.request.requestId,
    })
    expect(current.manager.setBundleEnabled).not.toHaveBeenCalled()
    expect(current.manager.removeBundle).not.toHaveBeenCalled()
  })

  it('accepts an empty readable bundle inventory and a uniquely verified installed target', async () => {
    for (const bundles of [[], [bundle()]]) {
      const current = await fixture(bundles)
      expect(await current.port.install(current.request)).toMatchObject({ kind: 'applied', changed: true })
      expect(current.manager.installBundle).toHaveBeenCalledTimes(1)
    }
  })

  it.each(['active', 'invalid'])('retains the official package-run barrier (%s)', async marker => {
    const current = await fixture()
    mkdirSync(join(current.root, '.plugin-manager'))
    await writeFile(join(current.root, '.plugin-manager', 'run.json'), marker === 'active'
      ? JSON.stringify({ pid: process.pid, grouped: false }) : '{invalid')
    expect(await current.port.install(current.request)).toMatchObject({ kind: 'unknown', errorCode: 'adapter/state-unknown' })
    expectNoOfficialWrites(current.manager)
  })

  it('rejects a second request while the first official install is active', async () => {
    const current = await fixture()
    const implementation = current.manager.installBundle.getMockImplementation()!
    let releaseInstall!: () => void
    let startedInstall!: () => void
    const released = new Promise<void>(resolve => { releaseInstall = resolve })
    const started = new Promise<void>(resolve => { startedInstall = resolve })
    current.manager.installBundle.mockImplementation(async path => {
      startedInstall()
      await released
      return implementation(path)
    })
    const first = current.port.install(current.request)
    await started
    try {
      expect(await current.port.install({ ...current.request, requestId: 'second-request' })).toMatchObject({ kind: 'unknown', errorCode: 'adapter/state-unknown' })
      expect(current.manager.installBundle).toHaveBeenCalledTimes(1)
    } finally {
      releaseInstall()
      await first
    }
  })

  it('does not replay a received request even if the inventory subsequently becomes unreadable', async () => {
    const current = await fixture()
    expect(await current.port.install(current.request)).toMatchObject({ kind: 'applied' })
    current.manager.listBundles.mockRejectedValue(new Error('synthetic read failure'))
    expect(await current.port.install(current.request)).toMatchObject({ kind: 'applied' })
    expect(current.manager.installBundle).toHaveBeenCalledTimes(1)
  })

  it('still rejects changed artifact bytes without an official write', async () => {
    const current = await fixture()
    await writeFile(current.request.artifact.localRef, 'changed')
    expect(await current.port.install(current.request)).toMatchObject({ kind: 'failed', changed: false, errorCode: 'artifact/integrity' })
    expectNoOfficialWrites(current.manager)
  })

  it('logs duplicate target uncertainty after an official applied result without corrective writes or replay', async () => {
    const current = await fixture()
    const implementation = current.manager.installBundle.getMockImplementation()!
    current.manager.installBundle.mockImplementationOnce(async path => {
      const result = await implementation(path)
      current.manager.listBundles.mockResolvedValue([bundle(), bundle()])
      return result
    })
    expect(await current.port.install(current.request)).toMatchObject({ kind: 'applied', changed: true })
    expect(current.entries.at(-1)).toMatchObject({
      packageName,
      officialResult: { kind: 'applied', changed: true },
      postcheck: expect.arrayContaining([{ check: '库存目标状态已核定', pass: false, reason: '官方库存仍把目标标为未知' }]),
    })
    expect(await current.port.install(current.request)).toMatchObject({ kind: 'applied', changed: true })
    expect(current.manager.installBundle).toHaveBeenCalledTimes(1)
    expect(current.manager.setBundleEnabled).not.toHaveBeenCalled()
  })

  it('does not correctively disable a target with duplicate identities after installation', async () => {
    const current = await fixture()
    const implementation = current.manager.installBundle.getMockImplementation()!
    current.manager.installBundle.mockImplementationOnce(async path => {
      const result = await implementation(path)
      await writeFile(join(current.root, 'package.json'), JSON.stringify({
        dependencies: { [packageName]: 'file:' + path }, dsh: { profile: { bundles: [packageName] } },
      }))
      current.manager.listBundles.mockResolvedValue([bundle(), bundle()])
      return result
    })
    expect(await current.port.install({ ...current.request, enabled: false })).toMatchObject({
      kind: 'unknown', error: 'explicit disable prerequisite changed or unavailable',
    })
    expect(current.manager.installBundle).toHaveBeenCalledTimes(1)
    expect(current.manager.setBundleEnabled).not.toHaveBeenCalled()
    expect(current.manager.removeBundle).not.toHaveBeenCalled()
  })
})

describe('HC-1 TaskManager to OfficialHostPort inventory safety', () => {
  it.each(['duplicate target', 'bundle read failure'])('rejects %s before calling HostPort install', async issue => {
    const current = await fixture(issue === 'duplicate target' ? [bundle(), bundle()] : [])
    if (issue === 'bundle read failure') current.manager.listBundles.mockRejectedValue(new Error('synthetic read failure'))
    const state = await current.port.readState()
    expect(state.inventory.unknownItems).toContain(issue === 'duplicate target'
      ? `bundle-entry:duplicate:${packageName}` : 'listBundles:synthetic read failure')
    const result = await startOfficialTask(current)
    expect(result.task.status).toBe('cancelled')
    expect(result.install).not.toHaveBeenCalled()
    expect(result.artifacts.acquire).not.toHaveBeenCalled()
    expectNoOfficialWrites(current.manager)
  })

  it('allows unrelated bundle diagnostics through the full TaskManager and official port chain', async () => {
    const current = await fixture([
      bundle(packageName + '-extra', { version: undefined }),
      bundle(packageName + '-extra', { version: undefined, rows: {} }),
    ])
    const result = await startOfficialTask(current)
    expect(result.task.status).toBe('completed')
    expect(result.task.items[0]).toMatchObject({ changed: true, installOutcome: 'applied' })
    expect(result.install).toHaveBeenCalledTimes(1)
    expect(result.artifacts.acquire).toHaveBeenCalledTimes(1)
    expect(current.manager.installBundle).toHaveBeenCalledTimes(1)
    expect(current.manager.setBundleEnabled).not.toHaveBeenCalled()
    expect(current.manager.removeBundle).not.toHaveBeenCalled()
  })
})
