/** Collect only selected market facts. Never read user conversations, settings or credentials. */
import { createHash } from 'node:crypto'
import type { AiAnalyzeRequest, CatalogSnapshot, DeliverySource, DiagnosticEntry, DiagnosticExport, InventorySnapshot, TaskState } from '../contracts/types.ts'
import { canonicalJson } from '../core/canonical.ts'

export function sourceIdentity(source: DeliverySource): string {
  return createHash('sha256').update(canonicalJson(source)).digest('hex').slice(0, 24)
}

export function sanitizeDiagnostic(value: string, limit = 1200): string {
  // Bound work before regexes as well as the final output. A truncated quoted
  // credential/path is redacted through end-of-input, never returned in pieces.
  return value.slice(0, 16_384)
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+)\b/g, '<secret>')
    .replace(/\b(?:authorization|proxy-authorization|cookie|set-cookie)["']?\s*:\s*[^\r\n]+/gi, '<redacted-header>')
    .replace(/\bBearer\s+\S+/gi, 'Bearer <secret>')
    .replace(/((?:[\w.-]*(?:token|secret|password|passwd|credential)|api[_-]?key|_auth)["']?\s*[=:]\s*)(?:"(?:\\.|[^"\\])*(?:"|$)|'(?:\\.|[^'\\])*(?:'|$)|[^\s,;}]+)/gi, '$1<secret>')
    .replace(/https?:\/\/[^\s"'<>]+/gi, (raw) => {
      try { const url = new URL(raw); return `${url.protocol}//${url.hostname}/<resource>` } catch { return '<url>' }
    })
    .replace(/(?:file:\/\/\/?)?(?<![A-Za-z0-9])(?:[A-Za-z]:[\\/]|\\\\)[^\r\n"'<>]*/g, '<local-path>')
    .replace(/(?<![A-Za-z0-9:/])(?:~?\/)(?:Users|home|tmp|var|private|etc|opt|root|mnt|media|Volumes|srv|run)(?:\/[^\r\n"'<>]*)/g, '<local-path>')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '<email>')
    .slice(0, Math.max(0, Math.min(limit, 1200)))
}

export function diagnosticDigest(diagnostic: DiagnosticExport): string {
  return createHash('sha256').update(JSON.stringify({ environmentId: diagnostic.environmentId, entries: diagnostic.diagnostics })).digest('hex')
}

export function collectDiagnostics(input: {
  readonly environmentId: string
  readonly hostVersion: string
  readonly marketVersion: string
  readonly selection?: AiAnalyzeRequest | undefined
  readonly tasks: readonly TaskState[]
  readonly inventory?: InventorySnapshot | undefined
  readonly catalog?: CatalogSnapshot | undefined
  readonly errors?: readonly string[] | undefined
}): DiagnosticExport {
  const diagnostics: DiagnosticEntry[] = []
  const add = (category: DiagnosticEntry['category'], message: string, source: string): void => {
    if (diagnostics.length >= 40) return
    diagnostics.push({ id: `fact-${diagnostics.length + 1}`, category, message: sanitizeDiagnostic(message), source, redacted: true })
  }
  add('environment', `宿主 ${input.hostVersion}；市场 ${input.marketVersion}`, 'host-adapter')
  if (input.catalog) add('catalog', `目录 ${input.catalog.revision}；来源 ${input.catalog.origin}；缓存过期 ${input.catalog.stale}`, 'catalog-snapshot')
  const selected = input.tasks.filter(task => task.environmentId === input.environmentId
    && (!input.selection?.taskId || task.taskId === input.selection.taskId)
    && (!input.selection?.packageName || task.items.some(item => item.packageName === input.selection?.packageName))).slice(-8)
  const packages = new Set<string>(input.selection?.packageName ? [input.selection.packageName] : [])
  for (const task of selected) {
    add('tasks', `任务 ${task.taskId}：${task.status}；下一步 ${task.nextAction}`, 'task-journal')
    for (const item of task.items.slice(0, 8)) {
      if (input.selection?.packageName && item.packageName !== input.selection.packageName) continue
      packages.add(item.packageName)
      add('install', `${item.packageName}@${item.targetVersion}：${item.status}；回执 ${item.installOutcome}；错误 ${item.errorCode ?? item.packageResultCode ?? '无'} ${item.error ?? ''}`, 'official-receipt')
      if (item.diagnostic) add('install', item.diagnostic, 'bounded-official-diagnostic')
    }
  }
  for (const item of input.inventory?.items ?? []) {
    if (!packages.has(item.packageName)) continue
    add('inventory', `${item.packageName}@${item.version ?? '未知'}：已装 ${item.installed}；启用配置 ${item.bundleEnabled}；来源 ${item.source}；待重启 ${item.restartRequired}；成员 ${item.rows.map(row => `${row.name}:${row.state}`).slice(0, 8).join(',')}`, 'official-inventory')
  }
  for (const plugin of input.catalog?.plugins ?? []) {
    if (!packages.has(plugin.packageName)) continue
    add('catalog', `${plugin.packageName}@${plugin.version}；验证 ${plugin.verification}；安装条件 ${plugin.installability}；制品 ${plugin.artifactDigest ?? '缺失'}`, 'catalog-release')
    const delivery = input.catalog?.deliveries.find(item => item.pluginId === plugin.id && item.version === plugin.version && item.artifactDigest === plugin.artifactDigest)
    if (delivery) add('catalog', `同一制品的已登记来源 ID：${delivery.sources.map(sourceIdentity).join(',')}`, 'catalog-delivery')
  }
  for (const error of [...(input.errors ?? []), ...(input.inventory?.unknownItems ?? [])].slice(0, 8)) add('unknown', error, 'bounded-market-diagnostic')
  return { schemaVersion: '1', generatedAt: new Date().toISOString(), marketVersion: input.marketVersion, environmentId: input.environmentId,
    summaries: ['所选任务与相关插件的脱敏事实；不包含用户会话、密钥或完整日志'], diagnostics, redacted: true }
}
