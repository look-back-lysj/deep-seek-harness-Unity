import type { PluginActionRecoveryRequest } from '../types.ts'

export interface ManagementPointer extends PluginActionRecoveryRequest {
  readonly environmentId: string
}

export class ManagementPointerStore {
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {}

  private key(environmentId: string): string {
    return `eac-market:management:${encodeURIComponent(environmentId)}`
  }

  read(environmentId: string): ManagementPointer | undefined {
    const raw = this.storage.getItem(this.key(environmentId))
    if (raw === null) return undefined
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) throw new Error('原管理指针损坏，不能确认原操作身份。')
    const pointer = value as Record<string, unknown>
    if (pointer.environmentId !== environmentId || typeof pointer.packageName !== 'string' || !pointer.packageName
      || typeof pointer.idempotencyKey !== 'string' || !pointer.idempotencyKey
      || !['enable', 'disable', 'remove'].includes(String(pointer.action))
      || (pointer.expectedVersion !== undefined && typeof pointer.expectedVersion !== 'string')) {
      throw new Error('原管理指针身份无效，不能安全发起新操作。')
    }
    return {
      environmentId, packageName: pointer.packageName, idempotencyKey: pointer.idempotencyKey,
      action: pointer.action as ManagementPointer['action'],
      ...(pointer.expectedVersion === undefined ? {} : { expectedVersion: pointer.expectedVersion as string }),
    }
  }

  save(pointer: ManagementPointer): void {
    if (this.read(pointer.environmentId)) throw new Error('此环境仍有原管理操作待核对。')
    const { environmentId, packageName, expectedVersion, action, idempotencyKey } = pointer
    this.storage.setItem(this.key(environmentId), JSON.stringify({
      environmentId, packageName, action, idempotencyKey,
      ...(expectedVersion === undefined ? {} : { expectedVersion }),
    }))
  }

  clear(pointer: ManagementPointer): void {
    const current = this.read(pointer.environmentId)
    if (!current || current.idempotencyKey !== pointer.idempotencyKey || current.packageName !== pointer.packageName
      || current.expectedVersion !== pointer.expectedVersion || current.action !== pointer.action) throw new Error('原管理指针已变化，不能解除保护。')
    this.storage.removeItem(this.key(pointer.environmentId))
  }
}
