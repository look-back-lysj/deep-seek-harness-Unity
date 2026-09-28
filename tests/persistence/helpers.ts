import type { TaskEvent, TaskState } from '../../packages/market/src/contracts/types.ts'
import type {
  ProfileLockHandle,
  ProfileLockPort,
  TaskItemFact,
  TaskRecord,
} from '../../packages/market/src/core/ports.ts'
import type { PlanBundle } from '../../packages/market/src/core/ports.ts'
import type { PersistenceFilePort } from '../../packages/market/src/persistence/files.ts'

export class InMemoryFiles implements PersistenceFilePort {
  readonly files = new Map<string, Uint8Array>()
  failNextAtomic = false
  readonly atomicWrites: string[] = []

  async read(path: string): Promise<Uint8Array | undefined> {
    return this.files.get(path)
  }

  async writeAtomic(path: string, data: Uint8Array): Promise<void> {
    this.atomicWrites.push(path)
    if (this.failNextAtomic) {
      this.failNextAtomic = false
      throw new Error('simulated atomic write failure')
    }
    this.files.set(path, new Uint8Array(data))
  }

  async append(path: string, data: Uint8Array): Promise<void> {
    const prior = this.files.get(path) ?? new Uint8Array()
    const next = new Uint8Array(prior.byteLength + data.byteLength)
    next.set(prior)
    next.set(data, prior.byteLength)
    this.files.set(path, next)
  }

  async list(prefix: string): Promise<readonly string[]> {
    return [...this.files.keys()].filter((path) => path.startsWith(prefix)).sort()
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path)
  }

  async size(path: string): Promise<number | undefined> {
    return this.files.get(path)?.byteLength
  }
}

export class TestLocks implements ProfileLockPort {
  private readonly tails = new Map<string, Promise<void>>()

  async acquire(profileKey: string): Promise<ProfileLockHandle> {
    const prior = this.tails.get(profileKey) ?? Promise.resolve()
    let releasePrior = (): void => {}
    const turn = new Promise<void>((resolve) => { releasePrior = resolve })
    this.tails.set(profileKey, prior.then(() => turn))
    await prior
    return {
      release: async () => releasePrior(),
    }
  }
}

export async function makeTaskRecord(bundle: PlanBundle, taskId = 'task-test'): Promise<TaskRecord> {
  const now = '2026-09-27T00:00:00.000Z'
  const state: TaskState = {
    taskId,
    planId: bundle.plan.planId,
    planDigest: bundle.plan.planDigest,
    environmentId: bundle.plan.environmentId,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    items: bundle.plan.items.map((item) => ({
      pluginId: item.pluginId,
      packageName: item.packageName,
      targetVersion: item.targetVersion,
      status: 'pending',
      changed: false,
      installOutcome: 'unknown',
      permissionChanges: [],
    })),
    events: [],
    nextAction: 'queued',
  }
  const itemFacts = Object.fromEntries(bundle.expected.map((item) => [item.pluginId, {
    installed: item.version !== undefined,
    active: item.enabled,
  } satisfies TaskItemFact]))
  return {
    task: state,
    bundle,
    baseline: { environmentId: bundle.plan.environmentId, revision: 'baseline', items: [], unknownItems: [] },
    itemFacts,
    attempts: [],
    idempotency: { start: 'start' },
    approvalIdempotency: {},
    resumeIdempotency: {},
    attemptCounter: 0,
    nextSequence: 0,
    cancellationRequested: false,
    eventLogTruncated: false,
  }
}

export function event(sequence: number, message = `event-${sequence}`): TaskEvent {
  return { sequence, at: '2026-09-27T00:00:00.000Z', phase: 'queued', message, level: 'info' }
}
