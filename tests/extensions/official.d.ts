/** Runtime aliases in vitest.config.ts point at the read-only official archive. */
declare module '@official/slot-registry' {
  export const SlotRegistry: typeof import('@deepseek-ai/dsh-client-ui-renderer/client').SlotRegistry
}
declare module '@official/module-system' {
  export class ClientModuleSystem {
    constructor(options: unknown)
    import(id: string, parent?: string, options?: object): Promise<Record<string, unknown>>
  }
}
declare module '@official/module-manifest' {
  export function parseBootManifest(raw: unknown): unknown
}
