import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { InstallLog, INSTALL_LOG_READ_MAX } from '../../packages/market-core/src/host/install-log.ts'

let directory: string

beforeAll(async () => { directory = await mkdtemp(join(tmpdir(), 'eac-install-log-')) })
afterAll(async () => { await rm(directory, { recursive: true, force: true }) })

describe('安装日志（B 档）', () => {
  it('追加后按时间从旧到新读取，并补齐 hostVersion', async () => {
    const log = new InstallLog(join(directory, 'roundtrip'), '0.1.6')
    log.append({ at: '2026-10-05T20:00:00.000Z', action: 'install', packageName: '@test/alpha', version: '1.2.3', taskId: 'task-1' })
    log.append({ at: '2026-10-05T20:01:00.000Z', action: 'remove', packageName: '@test/beta', officialResult: { kind: 'applied', changed: true } })
    await log.flush()
    const entries = await log.read()
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ action: 'install', packageName: '@test/alpha', version: '1.2.3', taskId: 'task-1', hostVersion: '0.1.6' })
    expect(entries[1]).toMatchObject({ action: 'remove', packageName: '@test/beta', officialResult: { kind: 'applied', changed: true } })
    expect(entries[0]!.at <= entries[1]!.at).toBe(true)
  })

  it('文件不存在时返回空列表而不是抛错', async () => {
    const log = new InstallLog(join(directory, 'missing'), '0.1.6')
    await expect(log.read()).resolves.toEqual([])
  })

  it('路径、令牌和凭据 URL 都被脱敏后才落盘', async () => {
    const log = new InstallLog(join(directory, 'redact'), '0.1.6')
    log.append({
      at: '2026-10-05T20:02:00.000Z',
      action: 'install',
      packageName: '@test/gamma',
      officialResult: { kind: 'unknown', error: '读取 C:\\Users\\demo\\profile\\node_modules 失败\ntoken=super-secret-value\n见 https://user:pass@example.invalid/x/y' },
      postcheck: [{ check: '来源为市场缓存文件', pass: false, reason: '来源 https://cdn.example.invalid/a.tgz 与 file:C:\\cache\\a.tgz 不符' }],
    })
    await log.flush()
    const raw = await readFile(join(directory, 'redact', 'install-log.jsonl'), 'utf8')
    expect(raw).not.toContain('C:\\Users\\demo')
    expect(raw).not.toContain('super-secret-value')
    expect(raw).not.toContain('user:pass@')
    expect(raw).not.toContain('example.invalid/x/y')
    const [entry] = await log.read()
    expect(entry?.officialResult?.error).toContain('<local-path>')
    expect(entry?.officialResult?.error).toContain('token=<secret>')
    expect(entry?.postcheck?.[0]?.pass).toBe(false)
    expect(entry?.postcheck?.[0]?.reason).toContain('<local-path>')
  })

  it('只读最近 N 条，并发追加不损坏，总量按 500 条封顶', async () => {
    const log = new InstallLog(join(directory, 'burst'), '0.1.6')
    for (let index = 0; index < INSTALL_LOG_READ_MAX + 10; index += 1) {
      log.append({ at: `2026-10-05T21:00:${String(index % 60).padStart(2, '0')}.${String(index).padStart(3, '0')}Z`, action: 'enable', packageName: `@test/pkg-${index}` })
    }
    await log.flush()
    const all = await log.read(10_000)
    expect(all).toHaveLength(INSTALL_LOG_READ_MAX)
    expect(all.at(-1)?.packageName).toBe(`@test/pkg-${INSTALL_LOG_READ_MAX + 9}`)
    const tail = await log.read(3)
    expect(tail).toHaveLength(3)
    expect(tail.map((entry) => entry.packageName)).toEqual(all.slice(-3).map((entry) => entry.packageName))
    // 每一行都必须是独立可解析的 JSON，说明没有交叉写坏。
    const lines = (await readFile(log.file, 'utf8')).split('\n').filter((line) => line.trim() !== '')
    expect(lines.length).toBe(INSTALL_LOG_READ_MAX + 10)
    expect(() => lines.forEach((line) => JSON.parse(line))).not.toThrow()
  })

  it('单行损坏只跳过该行，其余记录仍可读', async () => {
    const log = new InstallLog(join(directory, 'corrupt'), '0.1.6')
    await mkdir(join(directory, 'corrupt'), { recursive: true })
    await writeFile(log.file, ['{"at":"2026-10-05T22:00:00.000Z","action":"install","packageName":"@test/good","hostVersion":"0.1.6"}', '{broken json', ''].join('\n'), 'utf8')
    const entries = await log.read()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.packageName).toBe('@test/good')
  })
})
