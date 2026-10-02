import type { UpdatePolicy, UpdatePolicySaveRequest, UpdatePolicySnapshot } from '../contracts/types.ts'
import type { ProfileLockPort } from './ports.ts'
import { canonicalJson, sha256Hex } from './canonical.ts'
import { DEFAULT_UPDATE_POLICY } from './update-policy.ts'
import { decodeJson, encodeJson, type PersistenceFilePort } from '../persistence/files.ts'

interface StoredUpdatePolicy {
  readonly schemaVersion: '1'
  readonly revision: string
  readonly previousRevision: string
  readonly policy: UpdatePolicy
}

export class UpdatePolicyStoreError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'UpdatePolicyStoreError'
    this.code = code
  }
}

const PATH = 'settings/update-policy.json'
const OWNER = 'market-update-policy'

function clonePolicy(policy: UpdatePolicy): UpdatePolicy {
  return { ...policy }
}

function parsePolicy(value: unknown): UpdatePolicy {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new UpdatePolicyStoreError('update-policy/corrupt', 'Stored update policy must be an object')
  }
  const input = value as Record<string, unknown>
  const allowed = new Set(['automaticChecksEnabled', 'automaticDownloadsEnabled', 'automaticInstallsEnabled', 'intervalMinutes'])
  if (Object.keys(input).some(key => !allowed.has(key))) {
    throw new UpdatePolicyStoreError('update-policy/corrupt', 'Stored update policy contains unknown fields')
  }
  if (typeof input.automaticChecksEnabled !== 'boolean'
    || typeof input.automaticDownloadsEnabled !== 'boolean'
    || typeof input.automaticInstallsEnabled !== 'boolean') {
    throw new UpdatePolicyStoreError('update-policy/corrupt', 'Stored update policy booleans are invalid')
  }
  if (input.intervalMinutes !== undefined
    && (typeof input.intervalMinutes !== 'number' || !Number.isInteger(input.intervalMinutes)
      || input.intervalMinutes < 1 || input.intervalMinutes > 7 * 24 * 60)) {
    throw new UpdatePolicyStoreError('update-policy/corrupt', 'Stored update policy interval is invalid')
  }
  return {
    automaticChecksEnabled: input.automaticChecksEnabled,
    automaticDownloadsEnabled: input.automaticDownloadsEnabled,
    automaticInstallsEnabled: input.automaticInstallsEnabled,
    ...(input.intervalMinutes === undefined ? {} : { intervalMinutes: input.intervalMinutes as number }),
  }
}

async function revisionFor(previousRevision: string, policy: UpdatePolicy): Promise<string> {
  // Include the previous revision so an ABA sequence or a repeated identical
  // save still advances the compare-and-swap token.
  return `sha256:${await sha256Hex(canonicalJson({ previousRevision, policy }))}`
}

export class UpdatePolicyStore {
  constructor(
    private readonly files: PersistenceFilePort,
    private readonly locks: ProfileLockPort,
  ) {}

  private async readSnapshot(): Promise<UpdatePolicySnapshot> {
    const bytes = await this.files.read(PATH)
    if (bytes === undefined) {
      const policy = clonePolicy(DEFAULT_UPDATE_POLICY)
      return { revision: await revisionFor('update-policy/default-v1', policy), policy }
    }
    let value: unknown
    try { value = decodeJson(bytes) }
    catch (error) {
      throw new UpdatePolicyStoreError('update-policy/corrupt', error instanceof Error ? error.message : 'Stored update policy is corrupt')
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new UpdatePolicyStoreError('update-policy/corrupt', 'Stored update policy envelope is invalid')
    }
    const stored = value as Partial<StoredUpdatePolicy>
    if (stored.schemaVersion !== '1' || typeof stored.revision !== 'string' || typeof stored.previousRevision !== 'string') {
      throw new UpdatePolicyStoreError('update-policy/corrupt', 'Stored update policy version or revision is invalid')
    }
    const policy = parsePolicy(stored.policy)
    const revision = await revisionFor(stored.previousRevision, policy)
    if (revision !== stored.revision) throw new UpdatePolicyStoreError('update-policy/corrupt', 'Stored update policy revision does not match its contents')
    return { revision, policy }
  }

  async get(): Promise<UpdatePolicySnapshot> {
    const lock = await this.locks.acquire('settings:update-policy', OWNER)
    try {
      const snapshot = await this.readSnapshot()
      return { revision: snapshot.revision, policy: clonePolicy(snapshot.policy) }
    } finally { await lock.release() }
  }

  async save(request: UpdatePolicySaveRequest): Promise<UpdatePolicySnapshot> {
    if (typeof request?.expectedRevision !== 'string' || request.expectedRevision.length === 0) {
      throw new UpdatePolicyStoreError('update-policy/invalid-revision', 'A current update policy revision is required')
    }
    const policy = parsePolicy(request.policy)
    const lock = await this.locks.acquire('settings:update-policy', OWNER)
    try {
      const current = await this.readSnapshot()
      if (current.revision !== request.expectedRevision) {
        throw new UpdatePolicyStoreError('update-policy/revision-conflict', 'Update policy changed; read the current policy before saving')
      }
      const revision = await revisionFor(current.revision, policy)
      const document: StoredUpdatePolicy = { schemaVersion: '1', revision, previousRevision: current.revision, policy }
      await this.files.writeAtomic(PATH, encodeJson(document))
      return { revision, policy: clonePolicy(policy) }
    } finally { await lock.release() }
  }
}
