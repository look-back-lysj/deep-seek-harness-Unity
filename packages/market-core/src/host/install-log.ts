/**
 * 独立安装日志（B 档）：追加写 JSONL，只保留脱敏摘要。
 * 追加失败只打印错误，绝不影响安装/管理流程本身。
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { InstallLogCheck, InstallLogEntry, InstallLogOfficialResult } from '../contracts/types.ts'
import { sanitizeDiagnostic } from './diagnostics.ts'

/** 读取上限：设置页一次最多导出 500 条。 */
export const INSTALL_LOG_READ_MAX = 500

export type InstallLogInput = Omit<InstallLogEntry, 'hostVersion'>

function clean(value: string | undefined, limit: number): string | undefined {
  if (value === undefined) return undefined
  const result = sanitizeDiagnostic(value, limit)
  return result === '' ? undefined : result
}

function boundedCount(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return 100
  return Math.min(Math.max(1, Math.floor(limit)), INSTALL_LOG_READ_MAX)
}

function isEntry(value: unknown): value is InstallLogEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return typeof entry.at === 'string'
    && typeof entry.packageName === 'string'
    && typeof entry.hostVersion === 'string'
    && typeof entry.action === 'string'
}

function normalized(entry: InstallLogInput, hostVersion: string): InstallLogEntry {
  const errorCode = clean(entry.officialResult?.error, 400)
  const officialResult: InstallLogOfficialResult | undefined = entry.officialResult === undefined ? undefined : {
    kind: sanitizeDiagnostic(entry.officialResult.kind, 80),
    ...(entry.officialResult.changed === undefined ? {} : { changed: entry.officialResult.changed }),
    ...(errorCode === undefined ? {} : { error: errorCode }),
  }
  const postcheck: readonly InstallLogCheck[] | undefined = entry.postcheck?.map((check) => {
    const reason = clean(check.reason, 240)
    return {
      check: sanitizeDiagnostic(check.check, 120),
      pass: check.pass === true,
      ...(reason === undefined ? {} : { reason }),
    }
  })
  return {
    at: entry.at,
    action: entry.action,
    packageName: sanitizeDiagnostic(entry.packageName, 200),
    ...(clean(entry.version, 80) === undefined ? {} : { version: clean(entry.version, 80) }),
    ...(entry.artifactDigest === undefined ? {} : { artifactDigest: entry.artifactDigest.slice(0, 80) }),
    ...(entry.source === undefined ? {} : { source: sanitizeDiagnostic(entry.source, 80) }),
    ...(officialResult === undefined ? {} : { officialResult }),
    ...(postcheck === undefined ? {} : { postcheck }),
    ...(entry.taskId === undefined ? {} : { taskId: sanitizeDiagnostic(entry.taskId, 80) }),
    hostVersion,
  }
}

export class InstallLog {
  readonly file: string
  private tail: Promise<void> = Promise.resolve()

  constructor(directory: string, private readonly hostVersion: string) {
    this.file = join(directory, 'install-log.jsonl')
  }

  /** 追加一条日志；永不抛出。并发调用按入队顺序落盘，不会互相截断。 */
  append(entry: InstallLogInput): void {
    this.tail = this.tail.then(async () => {
      try {
        await mkdir(dirname(this.file), { recursive: true })
        await appendFile(this.file, JSON.stringify(normalized(entry, this.hostVersion)) + '\n', 'utf8')
      } catch (error) {
        console.error('[eac-market/install-log] 追加安装日志失败', error)
      }
    })
  }

  /** 等待已排队的追加完成，主要给测试与收尾使用。 */
  async flush(): Promise<void> { await this.tail }

  /** 读取最近 N 条（按时间从旧到新），上限 500。文件缺失或单行损坏都返回可读部分。 */
  async read(limit?: number): Promise<readonly InstallLogEntry[]> {
    await this.tail
    let raw: string
    try {
      raw = await readFile(this.file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[eac-market/install-log] 读取安装日志失败', error)
      }
      return []
    }
    const lines = raw.split('\n').filter((line) => line.trim() !== '').slice(-boundedCount(limit))
    const entries: InstallLogEntry[] = []
    for (const line of lines) {
      try {
        const value = JSON.parse(line) as unknown
        if (isEntry(value)) entries.push(value)
      } catch {
        // 单行损坏只跳过该行，不影响其余记录。
      }
    }
    return entries
  }
}
