/**
 * 受控目录来源配置。
 *
 * 目录地址不是“看到 HTTPS 就可信”：只有维护者显式登记的来源才可刷新。
 * 这里只负责配置、读取和回退，不把任何来源自动升级为正式发布授权。
 */
import { readLimitedResponse, safeFetch, type RemoteSecurityOptions } from '../delivery/security.ts'

export type CatalogSourceTrust = 'team-registered'

export interface CatalogSourceIdentity {
  readonly id: string
  readonly indexUrl: string
  readonly maintainer: string
  readonly trust: CatalogSourceTrust
  readonly fallbackId?: string
  /** 镜像共享的逻辑目录身份，由登记入口绑定，不由 UI 自行声明。 */
  readonly catalogId?: string
}

export interface CatalogSourceReadResult {
  readonly bytes: Uint8Array
  readonly source: CatalogSourceIdentity
  readonly fallbackUsed: boolean
}

export interface CatalogSourceConnection {
  readonly source: CatalogSourceIdentity
  readonly read: () => Promise<Uint8Array | string>
  readonly readResult?: () => Promise<CatalogSourceReadResult>
}

export interface CatalogSourceRegistryOptions {
  readonly maxBytes?: number
  readonly security?: RemoteSecurityOptions
  readonly fetch?: typeof fetch
}

export class CatalogSourceConfigurationError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'CatalogSourceConfigurationError'
    this.code = code
  }
}

const SOURCE_ID_RE = /^[a-z][a-z0-9-]{1,63}$/

/** Gitee raw URLs redirect to its signed content host. Accept only the exact
 * registered owner/repo/ref/path; never trust a different repo or an arbitrary
 * HTTPS redirect. safeFetch still checks DNS and credentials on every hop. */
export function isRegisteredCatalogRedirect(registered: string, target: URL): boolean {
  if (registered === target.href) return true
  const source = new URL(registered)
  return source.origin === 'https://gitee.com'
    && /^\/[^/]+\/[^/]+\/raw\//.test(source.pathname)
    && target.origin === 'https://raw.giteeusercontent.com'
    && !target.username && !target.password && !target.hash
    && target.pathname === source.pathname
    && target.search.length <= 8192
    && [...target.searchParams.keys()].every(key => key === 'metadata' || key === 'signature')
}

function validateSource(input: CatalogSourceIdentity): CatalogSourceIdentity {
  if (!SOURCE_ID_RE.test(input.id)) throw new CatalogSourceConfigurationError('catalog/source-invalid-id', '目录来源 id 无效')
  if (input.catalogId !== undefined && !SOURCE_ID_RE.test(input.catalogId)) throw new CatalogSourceConfigurationError('catalog/source-invalid-id', 'catalogId 无效')
  if (typeof input.maintainer !== 'string' || input.maintainer.trim().length === 0 || input.maintainer.length > 200) {
    throw new CatalogSourceConfigurationError('catalog/source-invalid-maintainer', '目录来源必须登记维护者')
  }
  if (input.trust !== 'team-registered') {
    throw new CatalogSourceConfigurationError('catalog/source-not-registered', `目录来源 ${input.id} 未登记为团队来源`)
  }
  let url: URL
  try {
    url = new URL(input.indexUrl)
  } catch {
    throw new CatalogSourceConfigurationError('catalog/source-invalid-url', '目录来源地址无效')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new CatalogSourceConfigurationError('catalog/source-invalid-url', '目录来源必须是无凭据 HTTPS 地址')
  }
  return { ...input, indexUrl: url.href }
}

export class CatalogSourceRegistry {
  private readonly sources = new Map<string, CatalogSourceIdentity>()
  private readonly options: CatalogSourceRegistryOptions

  constructor(sources: readonly CatalogSourceIdentity[], options: CatalogSourceRegistryOptions = {}) {
    for (const source of sources) {
      const validated = validateSource(source)
      if (this.sources.has(validated.id)) throw new CatalogSourceConfigurationError('catalog/source-duplicate', `目录来源 id 重复：${validated.id}`)
      this.sources.set(validated.id, Object.freeze(validated))
    }
    for (const source of this.sources.values()) {
      if (source.fallbackId !== undefined && !this.sources.has(source.fallbackId)) {
        throw new CatalogSourceConfigurationError('catalog/source-missing-fallback', `目录来源 ${source.id} 的回退来源不存在`)
      }
      const visited = new Set<string>()
      for (let next: string | undefined = source.id; next !== undefined; next = this.sources.get(next)?.fallbackId) {
        if (visited.has(next)) throw new CatalogSourceConfigurationError('catalog/source-fallback-cycle', '目录回退链存在循环')
        visited.add(next)
      }
    }
    this.options = options
  }

  list(): readonly CatalogSourceIdentity[] {
    return [...this.sources.values()].map(source => ({ ...source }))
  }

  resolve(sourceUrl?: string): CatalogSourceIdentity {
    const candidates = [...this.sources.values()]
    let requested: string | undefined
    if (sourceUrl !== undefined) {
      try {
        requested = new URL(sourceUrl).href
      } catch {
        throw new CatalogSourceConfigurationError('catalog/source-invalid-url', '目录地址无效')
      }
    }
    const source = requested === undefined
      ? candidates[0]
      : candidates.find((item) => item.indexUrl === requested)
    if (!source) throw new CatalogSourceConfigurationError('catalog/source-not-registered', '目录地址不在维护者登记列表中')
    return source
  }

  reader(request: { readonly sourceUrl?: string } = {}): () => Promise<Uint8Array | string> {
    return this.connection(request).read
  }

  connection(request: { readonly sourceUrl?: string } = {}): CatalogSourceConnection {
    const source = this.resolve(request.sourceUrl)
    const maxBytes = this.options.maxBytes ?? 8 * 1024 * 1024
    const readOne = async (candidate: CatalogSourceIdentity): Promise<Uint8Array> => {
      const signal = AbortSignal.timeout(this.options.security?.timeoutMs ?? 30_000)
      const response = await safeFetch(candidate.indexUrl, {
        ...this.options.security,
        ...(this.options.fetch === undefined ? {} : { fetch: this.options.fetch }),
        signal,
        validateRedirect: url => {
          if (!isRegisteredCatalogRedirect(candidate.indexUrl, url)) throw new CatalogSourceConfigurationError('catalog/source-redirect-not-registered', '目录重定向目标不在维护者登记列表中')
        },
      })
      return readLimitedResponse(response, maxBytes, signal)
    }
    const readResult = async (): Promise<CatalogSourceReadResult> => {
      const chain: CatalogSourceIdentity[] = [source]
      const seen = new Set<string>([source.id])
      for (let cursor = source.fallbackId; cursor !== undefined; cursor = this.sources.get(cursor)?.fallbackId) {
        if (seen.has(cursor)) break
        seen.add(cursor)
        const next = this.sources.get(cursor)
        if (next) chain.push(next)
      }
      let lastError: unknown
      for (let index = 0; index < chain.length; index += 1) {
        const candidate = chain[index] as CatalogSourceIdentity
        try {
          return { bytes: await readOne(candidate), source: { ...candidate, catalogId: source.catalogId ?? source.id }, fallbackUsed: index > 0 }
        } catch (error) {
          lastError = error
        }
      }
      throw lastError instanceof Error ? lastError : new CatalogSourceConfigurationError('catalog/source-unavailable', '目录来源不可用')
    }
    return {
      source,
      read: async () => (await readResult()).bytes,
      readResult,
    }
  }
}
