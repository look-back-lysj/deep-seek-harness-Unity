/**
 * 固定版本 Mojobox/DSH 公共格式校验。
 *
 * 这些校验只读公共 JSON 原字节，不把市场私有字段写回公共对象。
 * 解析成功只代表格式成立；运行验证仍由 Evidence 的绑定和状态单独决定。
 */
import { createHash } from 'node:crypto'
import type { CatalogPlugin, PackComponent } from '../contracts/types.ts'
import { CatalogValidationError, type CatalogHostEvidenceContext, type RawDocumentRecord } from './model.ts'
import { timestamp } from './input.ts'

const DIGEST_RE = /^sha256:[a-f0-9]{64}$/
const ID_RE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9][a-z0-9-]*)+$/
const SEMVER_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const PACK_LOCK_SCHEMA = 'https://mojobox.dev/schemas/pack-lock-v1alpha1.json'
const PACK_SCHEMA = 'https://mojobox.dev/schemas/pack-v1alpha1.json'
const EVIDENCE_SCHEMA = 'https://mojobox.dev/schemas/evidence-v1alpha1.json'

function fail(code: string, message: string): never {
  throw new CatalogValidationError(code, message)
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('catalog/invalid-public-format', `${field} 必须是对象`)
  return value as Record<string, unknown>
}

function exact(value: unknown, field: string, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  const object = record(value, field)
  const allowed = new Set([...required, ...optional])
  for (const key of required) if (object[key] === undefined) fail('catalog/invalid-public-format', `${field}.${key} 缺失`)
  for (const key of Object.keys(object)) if (!allowed.has(key)) fail('catalog/invalid-public-format', `${field}.${key} 不属于固定公共格式`)
  return object
}

function text(value: unknown, field: string, max = 4096): string {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > max) fail('catalog/invalid-public-format', `${field} 无效`)
  return value
}

function optionalText(value: unknown, field: string, max = 4096): string | undefined {
  return value === undefined ? undefined : text(value, field, max)
}

function digest(value: unknown, field: string): string {
  const result = text(value, field, 71)
  if (!DIGEST_RE.test(result)) fail('catalog/invalid-public-format', `${field} 必须是 sha256:<64位小写十六进制>`)
  return result
}

function id(value: unknown, field: string): string {
  const result = text(value, field, 200)
  if (!ID_RE.test(result)) fail('catalog/invalid-public-format', `${field} 不是稳定 ID`)
  return result
}

function semver(value: unknown, field: string): string {
  const result = text(value, field, 100)
  if (!SEMVER_RE.test(result)) fail('catalog/invalid-public-format', `${field} 不是精确 semver`)
  return result
}

function date(value: unknown, field: string): string {
  return timestamp(value, field)
}

function contractType(value: Record<string, unknown>, field: string): void {
  if (!/^[a-z][a-z0-9.-]*\/v[1-9][0-9]*(?:(?:alpha|beta)[1-9][0-9]*)?$/.test(text(value.apiVersion, `${field}.apiVersion`)) || !/^[A-Z][A-Za-z0-9]*$/.test(text(value.kind, `${field}.kind`))) fail('catalog/invalid-public-format', `${field} 契约标识无效`)
}

function rawJson(bytes: Uint8Array, field: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'))
  } catch {
    fail('catalog/invalid-public-format', `${field} 不是合法 JSON`)
  }
}

function assertUri(value: unknown, field: string): string {
  const result = text(value, field, 4096)
  try {
    new URL(result)
  } catch {
    fail('catalog/invalid-public-format', `${field} 不是 URI`)
  }
  return result
}

export function validatePackageMetadata(value: unknown, field: string, maxRangeBytes = 100): void {
  const object = exact(value, field, [], ['dependencies', 'peerDependencies', 'engines', 'dsh'])
  if (!Object.keys(object).length) fail('catalog/invalid-public-format', `${field} 不允许空投影`)
  for (const key of ['dependencies', 'peerDependencies'] as const) {
    if (object[key] !== undefined) {
      const deps = record(object[key], `${field}.${key}`)
      for (const [name, version] of Object.entries(deps)) {
        text(name, `${field}.${key}.name`, 214)
      text(version, `${field}.${key}.${name}`, maxRangeBytes)
      }
    }
  }
  if (object.engines !== undefined) {
    const engines = record(object.engines, `${field}.engines`)
    for (const [name, version] of Object.entries(engines)) {
      text(name, `${field}.engines.name`, 100)
      text(version, `${field}.engines.${name}`, maxRangeBytes)
    }
  }
  if (object.dsh !== undefined) {
    const dsh = exact(object.dsh, `${field}.dsh`, [], ['manifestVersion', 'bundle', 'profile', 'client'])
    if (dsh.manifestVersion !== undefined && dsh.manifestVersion !== 1) fail('catalog/invalid-public-format', `${field}.dsh.manifestVersion 必须是 1`)
    if (dsh.bundle !== undefined) {
      const bundle = exact(dsh.bundle, `${field}.dsh.bundle`, ['patch'])
      text(bundle.patch, `${field}.dsh.bundle.patch`)
    }
    if (dsh.profile !== undefined) {
      const profile = exact(dsh.profile, `${field}.dsh.profile`, [], ['bundles', 'patchReload'])
      if (profile.bundles !== undefined) {
        if (!Array.isArray(profile.bundles)) fail('catalog/invalid-public-format', `${field}.dsh.profile.bundles 必须是数组`)
        for (const item of profile.bundles) text(item, `${field}.dsh.profile.bundles[]`)
      }
      if (profile.patchReload !== undefined && !['live', 'startup'].includes(profile.patchReload as string)) {
        fail('catalog/invalid-public-format', `${field}.dsh.profile.patchReload 无效`)
      }
    }
    if (dsh.client !== undefined) {
      const client = exact(dsh.client, `${field}.dsh.client`, ['platform'], ['inject', 'immediately', 'external'])
      text(client.platform, `${field}.dsh.client.platform`)
      for (const key of ['inject', 'external'] as const) {
        if (client[key] !== undefined) {
          if (!Array.isArray(client[key])) fail('catalog/invalid-public-format', `${field}.dsh.client.${key} 必须是数组`)
          for (const item of client[key] as unknown[]) text(item, `${field}.dsh.client.${key}[]`)
        }
      }
      if (client.immediately !== undefined && typeof client.immediately !== 'boolean') fail('catalog/invalid-public-format', `${field}.dsh.client.immediately 必须是布尔值`)
    }
  }
}

export function validatePublicManifest(bytes: Uint8Array, plugin: Pick<CatalogPlugin, 'id' | 'version' | 'artifactDigest'>): void {
  const value = record(rawJson(bytes, 'Manifest'), 'Manifest')
  const allowed = new Set(['$schema', 'manifestVersion', 'id', 'name', 'version', 'facets', 'requires', 'permissions', 'contributes', 'subscriptions', 'license', 'source', 'artifact', 'compat', 'overrides'])
  for (const key of Object.keys(value)) if (!allowed.has(key) && !key.startsWith('x-')) fail('catalog/invalid-public-format', `Manifest.${key} 不属于 dsh-plugin-0.15`)
  for (const key of ['$schema', 'manifestVersion', 'id', 'name', 'version', 'facets']) if (value[key] === undefined) fail('catalog/invalid-public-format', `Manifest.${key} 缺失`)
  assertUri(value.$schema, 'Manifest.$schema')
  if (value.manifestVersion !== '0.15') fail('catalog/invalid-public-format', 'Manifest.manifestVersion 必须是 0.15')
  if (id(value.id, 'Manifest.id') !== plugin.id) fail('catalog/invalid-public-format', 'Manifest.id 与目录插件不一致')
  text(value.name, 'Manifest.name')
  if (semver(value.version, 'Manifest.version') !== plugin.version) fail('catalog/invalid-public-format', 'Manifest.version 与目录插件不一致')
  const facets = exact(value.facets, 'Manifest.facets', ['host'])
  const host = exact(facets.host, 'Manifest.facets.host', ['entry', 'apiVersion'])
  const entry = text(host.entry, 'Manifest.facets.host.entry')
  if (/^[\\/]/.test(entry) || /^[A-Za-z]:[\\/]/.test(entry) || /(^|[\\/])\.\.([\\/]|$)/.test(entry)) fail('catalog/invalid-public-format', 'Manifest.facets.host.entry 不安全')
  if (!/^v[1-9][0-9]*(?:(?:alpha|beta)[1-9][0-9]*)?$/.test(text(host.apiVersion, 'Manifest.facets.host.apiVersion'))) fail('catalog/invalid-public-format', 'Manifest.facets.host.apiVersion 无效')
  if (value.requires !== undefined) {
    const requires = exact(value.requires, 'Manifest.requires', [], ['contracts', 'services'])
    if (requires.services !== undefined && (!Array.isArray(requires.services) || requires.services.length !== 0)) fail('catalog/invalid-public-format', 'Manifest.requires.services 必须为空')
    if (requires.contracts !== undefined) {
      if (!Array.isArray(requires.contracts)) fail('catalog/invalid-public-format', 'Manifest.requires.contracts 必须是数组')
      for (const [index, item] of requires.contracts.entries()) {
        const contract = exact(item, `Manifest.requires.contracts[${index}]`, ['apiVersion', 'kind'], ['optional', 'fallback'])
        text(contract.apiVersion, `Manifest.requires.contracts[${index}].apiVersion`)
        text(contract.kind, `Manifest.requires.contracts[${index}].kind`)
        contractType(contract, `Manifest.requires.contracts[${index}]`)
        if (contract.optional !== undefined && typeof contract.optional !== 'boolean') fail('catalog/invalid-public-format', `Manifest.requires.contracts[${index}].optional 必须是布尔值`)
        optionalText(contract.fallback, `Manifest.requires.contracts[${index}].fallback`)
      }
    }
  }
  if (value.permissions !== undefined) {
    if (!Array.isArray(value.permissions)) fail('catalog/invalid-public-format', 'Manifest.permissions 必须是数组')
    for (const [index, item] of value.permissions.entries()) {
      const permission = exact(item, `Manifest.permissions[${index}]`, ['name', 'scope'], ['reason'])
      id(permission.name, `Manifest.permissions[${index}].name`)
      text(permission.scope, `Manifest.permissions[${index}].scope`)
      optionalText(permission.reason, `Manifest.permissions[${index}].reason`)
    }
  }
  if (value.contributes !== undefined) {
    const contributes = record(value.contributes, 'Manifest.contributes')
    for (const key of Object.keys(contributes)) if (!['commands', 'panels'].includes(key) && !key.startsWith('x-')) fail('catalog/invalid-public-format', `Manifest.contributes.${key} 不属于固定公共格式`)
    for (const key of Object.keys(contributes)) if (key.startsWith('x-') && !Array.isArray(contributes[key])) fail('catalog/invalid-public-format', `Manifest.contributes.${key} 必须是数组`)
    if (contributes.commands !== undefined) {
      if (!Array.isArray(contributes.commands)) fail('catalog/invalid-public-format', 'Manifest.contributes.commands 必须是数组')
      for (const [index, item] of contributes.commands.entries()) {
        const command = exact(item, `Manifest.contributes.commands[${index}]`, ['id', 'title'], ['description'])
        id(command.id, `Manifest.contributes.commands[${index}].id`)
        text(command.title, `Manifest.contributes.commands[${index}].title`)
        optionalText(command.description, `Manifest.contributes.commands[${index}].description`)
      }
    }
    if (contributes.panels !== undefined && (!Array.isArray(contributes.panels) || contributes.panels.length !== 0)) fail('catalog/invalid-public-format', 'Manifest.contributes.panels 必须为空')
  }
  if (value.subscriptions !== undefined) {
    if (!Array.isArray(value.subscriptions)) fail('catalog/invalid-public-format', 'Manifest.subscriptions 必须是数组')
    for (const [index, item] of value.subscriptions.entries()) {
      if (typeof item === 'string') {
        text(item, `Manifest.subscriptions[${index}]`)
      } else {
        const subscription = exact(item, `Manifest.subscriptions[${index}]`, ['apiVersion', 'kind'], ['scope'])
        text(subscription.apiVersion, `Manifest.subscriptions[${index}].apiVersion`)
        text(subscription.kind, `Manifest.subscriptions[${index}].kind`)
        contractType(subscription, `Manifest.subscriptions[${index}]`)
        optionalText(subscription.scope, `Manifest.subscriptions[${index}].scope`)
      }
    }
  }
  if (value.compat !== undefined) {
    const compat = exact(value.compat, 'Manifest.compat', [], ['hosts'])
    if (compat.hosts !== undefined) {
      if (!Array.isArray(compat.hosts)) fail('catalog/invalid-public-format', 'Manifest.compat.hosts 必须是数组')
      for (const [index, item] of compat.hosts.entries()) text(item, `Manifest.compat.hosts[${index}]`)
    }
  }
  if (value.overrides !== undefined) {
    if (!Array.isArray(value.overrides)) fail('catalog/invalid-public-format', 'Manifest.overrides 必须是数组')
    for (const [index, item] of value.overrides.entries()) {
      const override = exact(item, `Manifest.overrides[${index}]`, ['target', 'kind'], ['description'])
      text(override.target, `Manifest.overrides[${index}].target`)
      if (!['patch', 'native', 'build'].includes(override.kind as string)) fail('catalog/invalid-public-format', `Manifest.overrides[${index}].kind 无效`)
      optionalText(override.description, `Manifest.overrides[${index}].description`)
    }
  }
  if (value.artifact !== undefined) {
    const artifact = exact(value.artifact, 'Manifest.artifact', ['digest', 'algorithm', 'path'])
    digest(artifact.digest, 'Manifest.artifact.digest')
    if (artifact.algorithm !== 'sha256') fail('catalog/invalid-public-format', 'Manifest.artifact.algorithm 必须是 sha256')
    text(artifact.path, 'Manifest.artifact.path')
    if (plugin.artifactDigest !== undefined && artifact.digest !== plugin.artifactDigest) fail('catalog/invalid-public-format', 'Manifest.artifact.digest 与目录制品不一致')
  }
  if (value.source !== undefined) {
    const source = exact(value.source, 'Manifest.source', ['repository'], ['revision'])
    assertUri(source.repository, 'Manifest.source.repository')
    optionalText(source.revision, 'Manifest.source.revision', 64)
  }
  if (value['x-mojobox-package'] !== undefined) validatePackageMetadata(value['x-mojobox-package'], 'Manifest.x-mojobox-package')
}

export interface PublicPackLockComponent {
  readonly id: string
  readonly version: string
  readonly source: string
  readonly manifest: string
  readonly manifestDigest: string
  readonly artifactDigest: string
}

export function validatePublicPackLock(bytes: Uint8Array, packId: string, packVersion: string, expected: readonly PackComponent[]): readonly PublicPackLockComponent[] {
  const value = exact(rawJson(bytes, 'PackLock'), 'PackLock', ['$schema', 'apiVersion', 'kind', 'pack', 'components'])
  if (value.$schema !== PACK_LOCK_SCHEMA || value.apiVersion !== 'packs.mojobox.dev/v1alpha1' || value.kind !== 'PackLock') fail('catalog/invalid-public-format', 'PackLock 公共标识不正确')
  const pack = text(value.pack, 'PackLock.pack')
  if (pack !== `${packId}@${packVersion}`) fail('catalog/pack-lock-mismatch', 'PackLock.pack 与目录 Pack 不一致')
  if (!Array.isArray(value.components) || value.components.length === 0 || value.components.length > 64) fail('catalog/invalid-public-format', 'PackLock.components 数量无效')
  const components = value.components.map((item, index) => {
    const object = exact(item, `PackLock.components[${index}]`, ['id', 'version', 'source', 'manifest', 'manifestDigest', 'artifactDigest'])
    return {
      id: id(object.id, `PackLock.components[${index}].id`),
      version: semver(object.version, `PackLock.components[${index}].version`),
      source: text(object.source, `PackLock.components[${index}].source`),
      manifest: text(object.manifest, `PackLock.components[${index}].manifest`),
      manifestDigest: digest(object.manifestDigest, `PackLock.components[${index}].manifestDigest`),
      artifactDigest: digest(object.artifactDigest, `PackLock.components[${index}].artifactDigest`),
    }
  })
  const byId = new Map(components.map((item) => [item.id, item]))
  if (byId.size !== components.length) fail('catalog/pack-lock-mismatch', 'PackLock.components 有重复 id')
  if (components.length !== expected.length) fail('catalog/pack-lock-mismatch', 'PackLock.components 与 Pack 组件数量不一致')
  for (const component of expected) {
    const locked = byId.get(component.pluginId)
    if (!locked || locked.version !== component.version) fail('catalog/pack-lock-mismatch', `PackLock 缺少组件 ${component.pluginId}@${component.version}`)
    if (!/^npm:[a-z0-9@/_.-]+@[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(locked.source)) fail('catalog/invalid-public-format', 'PackLock.source 必须固定 npm 版本')
    if (!/^catalog\/plugins\/[a-z0-9.-]+\.json$/.test(locked.manifest)) fail('catalog/invalid-public-format', 'PackLock.manifest 路径不安全')
  }
  return components
}

export function validatePublicPack(bytes: Uint8Array, packId: string, packVersion: string, components: readonly PackComponent[]): void {
  const value = exact(rawJson(bytes, 'Pack'), 'Pack', ['$schema', 'apiVersion', 'kind', 'metadata', 'components'], ['requires'])
  if (value.$schema !== PACK_SCHEMA || value.apiVersion !== 'packs.mojobox.dev/v1alpha1' || value.kind !== 'Pack') fail('catalog/invalid-public-format', 'Pack 公共标识不正确')
  const metadata = exact(value.metadata, 'Pack.metadata', ['id', 'version', 'name', 'description'], ['category'])
  if (id(metadata.id, 'Pack.metadata.id') !== packId || semver(metadata.version, 'Pack.metadata.version') !== packVersion) fail('catalog/invalid-public-format', 'Pack.metadata 与目录 Pack 不一致')
  text(metadata.name, 'Pack.metadata.name', 80)
  text(metadata.description, 'Pack.metadata.description', 500)
  if (metadata.category !== undefined && !['function', 'appearance', 'workflow'].includes(metadata.category as string)) fail('catalog/invalid-public-format', 'Pack.metadata.category 无效')
  if (!Array.isArray(value.components) || value.components.length !== components.length) fail('catalog/invalid-public-format', 'Pack.components 与目录组件数量不一致')
  const expectedById = new Map(components.map((item) => [item.pluginId, item]))
  const seenIds = new Set<string>()
  if (!components.length || components.length > 64 || expectedById.size !== components.length) fail('catalog/invalid-public-format', 'Pack.components 为空、过多或重复')
  for (const [index, item] of value.components.entries()) {
    const object = exact(item, `Pack.components[${index}]`, ['id', 'version', 'required'])
    const componentId = id(object.id, `Pack.components[${index}].id`)
    if (seenIds.has(componentId)) fail('catalog/invalid-public-format', 'Pack.components 有重复 id')
    seenIds.add(componentId)
    const expected = expectedById.get(componentId)
    if (!expected || semver(object.version, `Pack.components[${index}].version`) !== expected.version || object.required !== expected.required) {
      fail('catalog/invalid-public-format', `Pack.components[${index}] 与目录组件不一致`)
    }
  }
  if (value.requires !== undefined) {
    const requires = exact(value.requires, 'Pack.requires', [], ['hostCapabilities', 'platforms'])
    if (requires.hostCapabilities !== undefined && !Array.isArray(requires.hostCapabilities)) fail('catalog/invalid-public-format', 'Pack.requires.hostCapabilities 必须是数组')
    if (Array.isArray(requires.hostCapabilities)) {
      const capabilities = requires.hostCapabilities.map(value => id(value, 'Pack.requires.hostCapabilities[]'))
      if (new Set(capabilities).size !== capabilities.length) fail('catalog/invalid-public-format', 'Pack.requires.hostCapabilities 重复')
    }
    if (requires.platforms !== undefined) {
      if (!Array.isArray(requires.platforms) || requires.platforms.length === 0) fail('catalog/invalid-public-format', 'Pack.requires.platforms 必须是非空数组')
      for (const [index, item] of requires.platforms.entries()) {
        const platform = exact(item, `Pack.requires.platforms[${index}]`, ['os'], ['arch'])
        if (!['win32', 'linux', 'darwin'].includes(platform.os as string)) fail('catalog/invalid-public-format', `Pack.requires.platforms[${index}].os 无效`)
        if (platform.arch !== undefined) {
          if (!Array.isArray(platform.arch)) fail('catalog/invalid-public-format', `Pack.requires.platforms[${index}].arch 必须是数组`)
          for (const arch of platform.arch) if (!['x64', 'arm64'].includes(arch as string)) fail('catalog/invalid-public-format', `Pack.requires.platforms[${index}].arch 无效`)
        }
      }
    }
  }
}

export interface EvidenceSummary {
  readonly level: string
  readonly result: string
  readonly revoked: boolean
  readonly expiresAt?: string
  readonly hostId?: string
  readonly hostDshVersion?: string
  readonly hostRuntime?: string
  readonly testedAt: string
  readonly checksPassed: boolean
}

export function validatePublicEvidence(bytes: Uint8Array, plugin: Pick<CatalogPlugin, 'id' | 'version' | 'artifactDigest'>, manifestDigest: string): EvidenceSummary {
  const value = exact(rawJson(bytes, 'Evidence'), 'Evidence', ['$schema', 'apiVersion', 'kind', 'subject', 'manifestDigest', 'specifications', 'suite', 'issuer', 'evidenceLevel', 'result', 'checks', 'testedAt', 'revoked'], ['hostDescriptorDigest', 'host', 'expiresAt', 'revokedAt', 'revocationReason'])
  if (value.$schema !== EVIDENCE_SCHEMA || value.apiVersion !== 'evidence.mojobox.dev/v1alpha1' || value.kind !== 'Evidence') fail('catalog/invalid-public-format', 'Evidence 公共标识不正确')
  const subject = exact(value.subject, 'Evidence.subject', ['id', 'version', 'artifactDigest'])
  if (id(subject.id, 'Evidence.subject.id') !== plugin.id || semver(subject.version, 'Evidence.subject.version') !== plugin.version) fail('catalog/evidence-binding-mismatch', 'Evidence.subject 未绑定目录插件版本')
  const artifactDigest = digest(subject.artifactDigest, 'Evidence.subject.artifactDigest')
  if (plugin.artifactDigest !== undefined && artifactDigest !== plugin.artifactDigest) fail('catalog/evidence-binding-mismatch', 'Evidence.subject.artifactDigest 与目录制品不一致')
  if (digest(value.manifestDigest, 'Evidence.manifestDigest') !== manifestDigest) fail('catalog/evidence-binding-mismatch', 'Evidence.manifestDigest 与 Manifest 原字节不一致')
  const specifications = exact(value.specifications, 'Evidence.specifications', ['dshStdRevision'], ['admissionProfile'])
  if (!/^[a-f0-9]{40}$/.test(text(specifications.dshStdRevision, 'Evidence.specifications.dshStdRevision', 40))) fail('catalog/invalid-public-format', 'Evidence.specifications.dshStdRevision 必须是完整 commit')
  optionalText(specifications.admissionProfile, 'Evidence.specifications.admissionProfile')
  const suite = exact(value.suite, 'Evidence.suite', ['id', 'version', 'digest'])
  text(suite.id, 'Evidence.suite.id')
  text(suite.version, 'Evidence.suite.version')
  digest(suite.digest, 'Evidence.suite.digest')
  text(value.issuer, 'Evidence.issuer')
  const level = text(value.evidenceLevel, 'Evidence.evidenceLevel')
  if (!['Declared', 'Parsed', 'Negotiated', 'Tested', 'Observed', 'Attested'].includes(level)) fail('catalog/invalid-public-format', 'Evidence.evidenceLevel 无效')
  const result = text(value.result, 'Evidence.result')
  if (!['pass', 'fail'].includes(result)) fail('catalog/invalid-public-format', 'Evidence.result 无效')
  if (!Array.isArray(value.checks) || value.checks.length === 0) fail('catalog/invalid-public-format', 'Evidence.checks 必须至少一项')
  for (const [index, item] of value.checks.entries()) {
    const check = exact(item, `Evidence.checks[${index}]`, ['id', 'result'], ['message'])
    text(check.id, `Evidence.checks[${index}].id`)
    if (!['pass', 'fail', 'skip'].includes(check.result as string)) fail('catalog/invalid-public-format', `Evidence.checks[${index}].result 无效`)
    optionalText(check.message, `Evidence.checks[${index}].message`)
  }
  const testedAt = date(value.testedAt, 'Evidence.testedAt')
  const checksPassed = value.checks.every(check => (check as { result: string }).result === 'pass')
  const expiresAt = value.expiresAt === undefined ? undefined : date(value.expiresAt, 'Evidence.expiresAt')
  const revoked = value.revoked
  if (typeof revoked !== 'boolean') fail('catalog/invalid-public-format', 'Evidence.revoked 必须是布尔值')
  if (revoked) {
    date(value.revokedAt, 'Evidence.revokedAt')
    text(value.revocationReason, 'Evidence.revocationReason')
  }
  const elevated = ['Negotiated', 'Tested', 'Observed', 'Attested'].includes(level)
  if (elevated) {
    digest(value.hostDescriptorDigest, 'Evidence.hostDescriptorDigest')
    const host = exact(value.host, 'Evidence.host', ['id', 'name', 'version', 'adapterVersion', 'dshVersion', 'runtime'])
    for (const key of ['id', 'name', 'version', 'adapterVersion', 'dshVersion', 'runtime'] as const) text(host[key], `Evidence.host.${key}`)
    return { level, result, revoked, testedAt, checksPassed, ...(expiresAt === undefined ? {} : { expiresAt }), hostId: host.id as string, hostDshVersion: host.dshVersion as string, hostRuntime: host.runtime as string }
  }
  return { level, result, revoked, testedAt, checksPassed, ...(expiresAt === undefined ? {} : { expiresAt }) }
}

export function evidenceSupportsVerification(summary: EvidenceSummary, context: CatalogHostEvidenceContext, now: Date): boolean {
  return summary.result === 'pass' &&
    summary.checksPassed && Date.parse(summary.testedAt) <= now.getTime() &&
    !summary.revoked &&
    ['Tested', 'Observed', 'Attested'].includes(summary.level) &&
    (summary.expiresAt === undefined || Date.parse(summary.expiresAt) > now.getTime()) &&
    summary.hostId === context.id &&
    summary.hostDshVersion === context.dshVersion &&
    summary.hostRuntime === context.runtime
}

export function rawDigest(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

export function rawRecord(bytes: Uint8Array): RawDocumentRecord {
  return { contentBase64: Buffer.from(bytes).toString('base64'), sha256: rawDigest(bytes) }
}
