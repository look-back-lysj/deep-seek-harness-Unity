import { canonicalJson, sha256Hex } from './canonical.ts'
import type { ProfileLockPort } from './ports.ts'
import {
  decodeJson,
  encodeJson,
  PersistenceError,
  type PersistenceFilePort,
} from '../persistence/files.ts'

const INTENT_PATH = 'maintenance/intent.json'
const INTENT_SCHEMA_VERSION = 1

export interface MaintenanceDependencyEdge {
  readonly prerequisite: string
  readonly consumer: string
}

export interface MaintenanceIntentState {
  /** Changes only when persisted user intent or dependency provenance changes. */
  readonly revision: number
  /** Packages explicitly chosen by the user; dependencies are tracked separately. */
  readonly explicitPackages: readonly string[]
  readonly dependencyEdges: readonly MaintenanceDependencyEdge[]
}

interface MaintenanceIntentDocument {
  readonly schemaVersion: typeof INTENT_SCHEMA_VERSION
  readonly digest: string
  readonly state: MaintenanceIntentState
}

function validPackageName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 214
    && !/[\u0000-\u001f\u007f]/.test(value) && value.trim() === value
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort()
}

function normalizeState(value: unknown): MaintenanceIntentState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PersistenceError('maintenance/intent-corrupt', '维护意图记录结构无效；保留原文件供诊断')
  }
  const raw = value as Record<string, unknown>
  if (!Number.isSafeInteger(raw.revision) || (raw.revision as number) < 0
    || !Array.isArray(raw.explicitPackages) || !Array.isArray(raw.dependencyEdges)) {
    throw new PersistenceError('maintenance/intent-corrupt', '维护意图记录版本或字段无效；保留原文件供诊断')
  }
  if (!raw.explicitPackages.every(validPackageName)) {
    throw new PersistenceError('maintenance/intent-corrupt', '维护意图中存在无效包名；保留原文件供诊断')
  }
  const explicitPackages = sortedUnique(raw.explicitPackages as string[])
  const dependencyEdges: MaintenanceDependencyEdge[] = []
  for (const edge of raw.dependencyEdges) {
    if (typeof edge !== 'object' || edge === null || Array.isArray(edge)) {
      throw new PersistenceError('maintenance/intent-corrupt', '依赖关系记录结构无效；保留原文件供诊断')
    }
    const row = edge as Record<string, unknown>
    if (!validPackageName(row.prerequisite) || !validPackageName(row.consumer) || row.prerequisite === row.consumer) {
      throw new PersistenceError('maintenance/intent-corrupt', '依赖关系记录身份无效；保留原文件供诊断')
    }
    dependencyEdges.push({ prerequisite: row.prerequisite, consumer: row.consumer })
  }
  const edges = [...new Map(dependencyEdges.map(edge => [`${edge.prerequisite}\u0000${edge.consumer}`, edge])).values()]
    .sort((left, right) => left.prerequisite.localeCompare(right.prerequisite) || left.consumer.localeCompare(right.consumer))
  return { revision: raw.revision as number, explicitPackages, dependencyEdges: edges }
}

function validateDocument(value: unknown): MaintenanceIntentDocument {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PersistenceError('maintenance/intent-corrupt', '维护意图文件损坏；保留原文件供诊断')
  }
  const raw = value as Record<string, unknown>
  if (raw.schemaVersion !== INTENT_SCHEMA_VERSION || typeof raw.digest !== 'string' || !/^[a-f0-9]{64}$/.test(raw.digest)) {
    throw new PersistenceError('maintenance/intent-version', '维护意图文件版本或摘要格式不受支持；保留原文件供诊断')
  }
  const state = normalizeState(raw.state)
  return { schemaVersion: INTENT_SCHEMA_VERSION, digest: raw.digest, state }
}

function sameContent(left: MaintenanceIntentState, right: MaintenanceIntentState): boolean {
  return canonicalJson({ explicitPackages: left.explicitPackages, dependencyEdges: left.dependencyEdges })
    === canonicalJson({ explicitPackages: right.explicitPackages, dependencyEdges: right.dependencyEdges })
}

/**
 * Profile-local, checksum-protected storage for user intent. It deliberately
 * does not reconstruct Explicit from successful historical task receipts.
 * Atomic writes and a profile lock prevent partial or lost updates.
 */
export class MaintenanceIntentStore {
  constructor(
    private readonly files: PersistenceFilePort,
    private readonly locks: ProfileLockPort,
    private readonly owner = 'maintenance-intent-store',
  ) {}

  async load(): Promise<MaintenanceIntentState> {
    const bytes = await this.files.read(INTENT_PATH)
    if (bytes === undefined) return { revision: 0, explicitPackages: [], dependencyEdges: [] }
    let document: MaintenanceIntentDocument
    try {
      document = validateDocument(decodeJson(bytes))
      const expected = await sha256Hex(canonicalJson(document.state))
      if (document.digest !== expected) {
        throw new PersistenceError('maintenance/intent-checksum', '维护意图校验失败；保留原文件供诊断')
      }
    } catch (error) {
      if (error instanceof PersistenceError) throw error
      throw new PersistenceError('maintenance/intent-corrupt', '维护意图文件损坏；保留原文件供诊断', true, { cause: error })
    }
    return document.state
  }


  private async mutate(
    transform: (current: MaintenanceIntentState) => Omit<MaintenanceIntentState, 'revision'>,
  ): Promise<MaintenanceIntentState> {
    const handle = await this.locks.acquire('maintenance-intent', this.owner)
    try {
      const current = await this.load()
      const normalized = normalizeState({ revision: current.revision, ...transform(current) })
      if (sameContent(current, normalized)) return current
      const state = { ...normalized, revision: current.revision + 1 }
      const document: MaintenanceIntentDocument = {
        schemaVersion: INTENT_SCHEMA_VERSION,
        digest: await sha256Hex(canonicalJson(state)),
        state,
      }
      await this.files.writeAtomic(INTENT_PATH, encodeJson(document))
      return state
    } finally {
      await handle.release()
    }
  }

  async replace(next: Omit<MaintenanceIntentState, 'revision'>): Promise<MaintenanceIntentState> {
    return this.mutate(() => next)
  }

  async recordPlan(explicitPackages: readonly string[], dependencyEdges: readonly MaintenanceDependencyEdge[]): Promise<MaintenanceIntentState> {
    return this.mutate(current => {
      const explicit = new Set(current.explicitPackages)
      for (const name of explicitPackages) {
        if (!validPackageName(name)) throw new PersistenceError('maintenance/intent-input', '用户明确选择的包名无效')
        explicit.add(name)
      }
      // Replace only the graph belonging to the newly chosen consumers.
      const consumers = new Set(explicitPackages)
      const edgesByConsumer = new Map(current.dependencyEdges
        .filter(edge => !consumers.has(edge.consumer))
        .map(edge => [`${edge.prerequisite}\u0000${edge.consumer}`, edge]))
      for (const edge of dependencyEdges) {
        if (!validPackageName(edge.prerequisite) || !validPackageName(edge.consumer) || edge.prerequisite === edge.consumer) {
          throw new PersistenceError('maintenance/intent-input', '计划依赖关系无效')
        }
        edgesByConsumer.set(`${edge.prerequisite}\u0000${edge.consumer}`, edge)
      }
      return { explicitPackages: [...explicit], dependencyEdges: [...edgesByConsumer.values()] }
    })
  }

  async setExplicit(packageName: string, explicit: boolean): Promise<MaintenanceIntentState> {
    if (!validPackageName(packageName)) throw new PersistenceError('maintenance/intent-input', '用户选择的包名无效')
    return this.mutate(current => {
      const explicitPackages = new Set(current.explicitPackages)
      if (explicit) explicitPackages.add(packageName)
      else explicitPackages.delete(packageName)
      const dependencyEdges = explicit ? current.dependencyEdges : current.dependencyEdges.filter(edge => edge.consumer !== packageName)
      return { explicitPackages: [...explicitPackages], dependencyEdges }
    })
  }

  async clearPackage(packageName: string): Promise<MaintenanceIntentState> {
    if (!validPackageName(packageName)) throw new PersistenceError('maintenance/intent-input', '用户选择的包名无效')
    return this.mutate(current => ({
      explicitPackages: current.explicitPackages.filter(name => name !== packageName),
      dependencyEdges: current.dependencyEdges.filter(edge => edge.consumer !== packageName && edge.prerequisite !== packageName),
    }))
  }

}

export const MAINTENANCE_INTENT_PATH = INTENT_PATH
