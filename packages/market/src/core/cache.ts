/**
 * Cache reference accounting. A cached tgz is deletable only when no active
 * task and no installed market-managed dependency still references it.
 */
export interface CacheReference {
  readonly digest: string
  readonly localRef: string
  readonly taskId?: string
  readonly packageName?: string
  readonly installed: boolean
}

export interface CacheCleanupDecision {
  readonly deletableLocalRefs: readonly string[]
  readonly protectedLocalRefs: readonly string[]
}

export class CacheReferenceIndex {
  private readonly references = new Map<string, CacheReference>()

  constructor(initial: readonly CacheReference[] = []) {
    for (const reference of initial) this.references.set(reference.localRef, { ...reference })
  }

  retain(reference: CacheReference): void {
    this.references.set(reference.localRef, { ...reference })
  }

  markInstalled(localRef: string, packageName: string): void {
    const prior = this.references.get(localRef)
    if (prior === undefined) throw new Error('cache reference is not registered')
    this.references.set(localRef, { ...prior, packageName, installed: true })
  }

  releaseTask(taskId: string): void {
    for (const [key, reference] of this.references) {
      if (reference.taskId !== taskId || reference.installed) continue
      // Keep the row so the cleaner can make an explicit delete decision;
      // removing it here would hide a still-present cache file.
      const { taskId: _released, ...withoutTask } = reference
      this.references.set(key, withoutTask)
    }
  }

  snapshot(): readonly CacheReference[] {
    return [...this.references.values()].map((reference) => ({ ...reference }))
  }

  collect(activeTaskIds: readonly string[]): CacheCleanupDecision {
    const active = new Set(activeTaskIds)
    const deletableLocalRefs: string[] = []
    const protectedLocalRefs: string[] = []
    for (const reference of this.references.values()) {
      const protectedRef = reference.installed || (reference.taskId !== undefined && active.has(reference.taskId))
      if (protectedRef) protectedLocalRefs.push(reference.localRef)
      else deletableLocalRefs.push(reference.localRef)
    }
    return { deletableLocalRefs, protectedLocalRefs }
  }
}
