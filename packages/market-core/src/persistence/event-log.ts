/**
 * Segmented, paginated task event log.
 *
 * Summary JSON remains authoritative for current status. Event segments are
 * append-only, bounded and independently readable; a torn final JSONL line is
 * ignored with `truncated=true`, while corruption in the middle fails closed.
 */
import type { TaskEvent } from '../contracts/types.ts'
import type { TaskEventLogPort, EventLogPage } from '../core/ports.ts'
import {
  decodeJson,
  PersistenceError,
  safeStoreId,
  taskDirectory,
  writeJsonDocument,
  type PersistenceFilePort,
} from './files.ts'

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

interface EventLogMeta {
  readonly schemaVersion: 1
  readonly truncated: boolean
}

function segmentName(index: number): string {
  return `events-${String(index).padStart(6, '0')}.jsonl`
}

function parseMeta(raw: unknown): EventLogMeta {
  const value = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
  return { schemaVersion: 1, truncated: value.truncated === true }
}

function parseEventLine(line: string, allowTornFinal: boolean): TaskEvent | 'torn' {
  try {
    const raw = decodeJson(encoder.encode(line)) as Record<string, unknown>
    if (typeof raw.sequence !== 'number' || typeof raw.phase !== 'string' || typeof raw.message !== 'string') {
      throw new PersistenceError('events/invalid', '事件字段不完整')
    }
    return raw as unknown as TaskEvent
  } catch (error) {
    if (allowTornFinal) return 'torn'
    throw error
  }
}

export class SegmentedEventLog implements TaskEventLogPort {
  constructor(
    private readonly files: PersistenceFilePort,
    private readonly maxSegmentBytes = 64 * 1024,
  ) {}

  private paths(taskId: string): string {
    return `${taskDirectory(taskId)}`
  }

  private async segments(taskId: string): Promise<readonly string[]> {
    const prefix = `${this.paths(taskId)}/`
    const all = await this.files.list(prefix)
    return all
      .filter((path) => /^events-\d{6}\.jsonl$/.test(path.slice(prefix.length)))
      .sort((left, right) => left.localeCompare(right))
  }

  async append(taskId: string, event: TaskEvent): Promise<void> {
    safeStoreId(taskId)
    const existing = await this.read(taskId, -1, Number.MAX_SAFE_INTEGER)
    const expectedSequence = (existing.events.at(-1)?.sequence ?? -1) + 1
    if (event.sequence !== expectedSequence) {
      throw new PersistenceError('events/sequence', `事件序号必须连续，期望 ${expectedSequence}，收到 ${event.sequence}`)
    }
    const line = encoder.encode(`${JSON.stringify(event)}\n`)
    const segments = await this.segments(taskId)
    let target = segments.at(-1)
    let index = segments.length === 0 ? 1 : Number(target?.slice(-10, -6) ?? '0')
    if (target === undefined) target = `${this.paths(taskId)}/${segmentName(index)}`
    const size = await this.files.size(target)
    const priorBytes = size === undefined ? undefined : await this.files.read(target)
    const priorText = priorBytes === undefined ? '' : decoder.decode(priorBytes)
    // A crash may leave a torn final line without a newline. Never append into
    // that line; rotate so the valid prefix remains diagnosable.
    const tornTail = priorText.length > 0 && !priorText.endsWith('\n')
    if (tornTail || (size !== undefined && size + line.byteLength > this.maxSegmentBytes)) {
      index += 1
      target = `${this.paths(taskId)}/${segmentName(index)}`
    }
    await this.files.append(target, line)
  }

  async read(taskId: string, afterSequence: number, limit: number): Promise<EventLogPage> {
    safeStoreId(taskId)
    const events: TaskEvent[] = []
    let torn = false
    for (const path of await this.segments(taskId)) {
      const bytes = await this.files.read(path)
      if (bytes === undefined) continue
      const text = decoder.decode(bytes)
      const lines = text.split('\n')
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]
        if (line === undefined || line.length === 0) continue
        const parsed = parseEventLine(line, index === lines.length - 1 && !text.endsWith('\n'))
        if (parsed === 'torn') {
          torn = true
          continue
        }
        if (parsed.sequence > afterSequence) events.push(parsed)
      }
    }
    events.sort((left, right) => left.sequence - right.sequence)
    const metaData = await this.files.read(`${this.paths(taskId)}/event-log-meta.json`)
    const truncated = torn || (metaData !== undefined && parseMeta(decodeJson(metaData)).truncated)
    const pageEvents = events.slice(0, Math.max(0, limit))
    return {
      events: pageEvents,
      nextSequence: (pageEvents.at(-1)?.sequence ?? afterSequence) + 1,
      truncated,
    }
  }

  async cleanup(taskId: string, maxBytes: number): Promise<{ removedSegments: number; truncated: boolean }> {
    safeStoreId(taskId)
    const segments = await this.segments(taskId)
    const sizes: { path: string; size: number }[] = []
    for (const path of segments) sizes.push({ path, size: await this.files.size(path) ?? 0 })
    let total = sizes.reduce((sum, item) => sum + item.size, 0)
    let removed = 0
    while (total > maxBytes && sizes.length > 1) {
      const removedSegment = sizes.shift()
      if (removedSegment === undefined) break
      await this.files.remove(removedSegment.path)
      total -= removedSegment.size
      removed += 1
    }
    const truncated = removed > 0
    if (truncated) {
      await writeJsonDocument(this.files, `${this.paths(taskId)}/event-log-meta.json`, {
        schemaVersion: 1,
        truncated: true,
      } satisfies EventLogMeta)
    }
    return { removedSegments: removed, truncated }
  }
}
