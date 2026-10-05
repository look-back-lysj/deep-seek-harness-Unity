import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readSupplyDraft, SUPPLY_DRAFT_MAX_BYTES } from '../../packages/market-core/src/catalog/supply-draft-read.ts'
import { validateSupplyDraft } from '../../packages/market-core/src/catalog/supply-draft-validate.ts'
import { classifySupplyDraft } from '../../packages/market-core/src/catalog/supply-draft-classify.ts'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
let directory: string

beforeAll(async () => { directory = await mkdtemp(join(tmpdir(), 'eac-supply-draft-')) })
afterAll(async () => { await rm(directory, { recursive: true, force: true }) })

function validBatch(): Record<string, unknown> {
  return {
    schemaVersion: 'supply.eac/v1',
    sourceId: 'dsh-eac.mojobox',
    sequence: 1,
    revision: '2026-10-05.1',
    generatedAt: '2026-10-05T12:00:00Z',
    items: [
      {
        type: 'plugin',
        packageName: 'dsh-better-sidebar',
        version: '0.12.2',
        name: '侧栏增强',
        summary: '把侧栏整理成更清晰的分组。',
        source: { url: 'https://example.org/sidebar', commit: null },
        status: 'active',
        runtime: 'not-tested',
        requiresDsh: null,
        compatibilityBasis: 'unknown',
      },
      {
        type: 'material',
        packageName: 'blue-fantasy',
        version: '1.0.0',
        name: '蓝梦 Prompt 资料',
        summary: '一套可直接参考的提示词资料。',
        source: { url: 'https://example.org/blue-fantasy', commit: null },
        status: 'active',
        runtime: 'not-tested',
        installable: false,
      },
    ],
  }
}

function packBatch(): Record<string, unknown> {
  return {
    schemaVersion: 'supply.eac/v1',
    sourceId: 'dsh-eac.mojobox',
    sequence: 2,
    revision: '2026-10-05.2',
    generatedAt: '2026-10-05T13:00:00Z',
    items: [
      {
        type: 'function-pack',
        packageName: 'org.example.essentials',
        version: '1.0.0',
        name: '基础工具组合',
        summary: '组件产物尚未解析。',
        source: { url: 'https://example.org/essentials', commit: null },
        status: 'active',
        runtime: 'not-tested',
        components: [{ id: 'editor', ref: '@example/editor-tools', version: '^1.0.0' }],
        execution: {
          coverage: 'unknown',
          edges: [{ prerequisiteId: 'context', consumerId: 'editor', milestone: 'installed' }],
        },
      },
    ],
  }
}

async function write(name: string, text: string): Promise<string> {
  const path = join(directory, name)
  await writeFile(path, text, 'utf8')
  return path
}

describe('供货草稿读取（A1）', () => {
  it('读取合法 JSON 并返回原始字节数', async () => {
    const path = await write('ok.json', JSON.stringify(validBatch()))
    const result = await readSupplyDraft(path)
    expect(result.bytes).toBeGreaterThan(0)
    expect((result.document as { schemaVersion: string }).schemaVersion).toBe('supply.eac/v1')
  })

  it('超过 8 MiB 直接拒绝，不解析内容', async () => {
    const path = join(directory, 'huge.json')
    await writeFile(path, 'x'.repeat(SUPPLY_DRAFT_MAX_BYTES + 1), 'utf8')
    await expect(readSupplyDraft(path)).rejects.toThrow(/8 MiB/)
  })

  it('非法 JSON 与缺失文件都给中文原因且不返回半份结果', async () => {
    const broken = await write('broken.json', '{"schemaVersion":')
    await expect(readSupplyDraft(broken)).rejects.toThrow(/不是合法 JSON/)
    await expect(readSupplyDraft(join(directory, 'missing.json'))).rejects.toThrow(/无法访问/)
    await expect(readSupplyDraft('')).rejects.toThrow(/路径为空/)
  })
})

describe('供货草稿校验（A2）', () => {
  it('合法批次：一个无产物插件 + 一条资料，两层校验都通过', async () => {
    const path = await write('valid.json', JSON.stringify(validBatch()))
    const { document } = await readSupplyDraft(path)
    expect(validateSupplyDraft(document)).toEqual({ ok: true, errors: [] })
    const classified = classifySupplyDraft(document)
    expect(classified.ok).toBe(true)
    expect(classified.items.map(item => item.class)).toEqual(['source-only', 'material'])
    expect(classified.items[0]?.reasons[0]).toContain('缺少 artifact')
    expect(classified.items[1]?.reasons[0]).toContain('任何安装路径都拒绝')
  })

  const mutations: readonly [string, (batch: Record<string, unknown>) => void, RegExp][] = [
    ['未知类型 skill', batch => { (batch.items as Record<string, unknown>[])[0]!.type = 'skill' }, /白名单/],
    ['latest 版本', batch => { (batch.items as Record<string, unknown>[])[0]!.version = 'latest' }, /精确 SemVer/],
    ['material 携带 artifact', batch => { (batch.items as Record<string, unknown>[])[1]!.artifact = { format: 'npm-tgz', downloadUrl: 'https://example.org/m.tgz', sha256: 'a'.repeat(64), size: 12 } }, /禁止携带 artifact/],
    ['身份重复', batch => { (batch.items as Record<string, unknown>[])[1]!.packageName = 'dsh-better-sidebar'; (batch.items as Record<string, unknown>[])[1]!.version = '0.12.2' }, /身份重复/],
    ['requiresDsh 为 null 却声明作者依据', batch => { (batch.items as Record<string, unknown>[])[0]!.compatibilityBasis = 'author-declared' }, /compatibilityBasis 必须是 unknown/],
    ['执行边引用不存在的组件', batch => { batch.items = packBatch().items }, /引用了不存在的组件/],
  ]

  it.each(mutations)('%s 必须整批拒绝', (_name, mutate, expected) => {
    const batch = validBatch()
    if (_name === '执行边引用不存在的组件') {
      mutate(batch)
      const pack = (batch.items as Record<string, unknown>[])[0]!
      ;(pack.execution as { edges: unknown[] }).edges = [{ prerequisiteId: 'ghost', consumerId: 'editor', milestone: 'installed' }]
    } else mutate(batch)
    const result = validateSupplyDraft(batch)
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(expected)
    expect(classifySupplyDraft(batch)).toMatchObject({ ok: false, items: [] })
  })

  it('执行边自环与成环都会被拒绝', () => {
    const selfLoop = packBatch()
    const pack = (selfLoop.items as Record<string, unknown>[])[0]!
    ;(pack.components as unknown[]).push({ id: 'context', ref: 'builtin:context' })
    ;(pack.execution as { edges: unknown[] }).edges = [{ prerequisiteId: 'editor', consumerId: 'editor', milestone: 'installed' }]
    expect(validateSupplyDraft(selfLoop).errors.join('\n')).toMatch(/自依赖/)

    const cycle = packBatch()
    const cyclePack = (cycle.items as Record<string, unknown>[])[0]!
    ;(cyclePack.components as unknown[]).push({ id: 'context', ref: 'builtin:context' })
    ;(cyclePack.execution as { edges: unknown[] }).edges = [
      { prerequisiteId: 'context', consumerId: 'editor', milestone: 'installed' },
      { prerequisiteId: 'editor', consumerId: 'context', milestone: 'active' },
    ]
    expect(validateSupplyDraft(cycle).errors.join('\n')).toMatch(/循环依赖/)
  })
})

describe('供货草稿四档分类（A3）', () => {
  it('完整产物进安装候选，撤回只做来源展示，组合保持未解析', () => {
    const batch = validBatch()
    const plugin = (batch.items as Record<string, unknown>[])[0]!
    plugin.artifact = { format: 'npm-tgz', downloadUrl: 'https://example.org/sidebar.tgz', sha256: 'a'.repeat(64), size: 2048 }
    const withdrawn = structuredClone(batch)
    ;(withdrawn.items as Record<string, unknown>[])[0]!.status = 'withdrawn'
    expect(classifySupplyDraft(batch).items[0]?.class).toBe('install-candidate')
    expect(classifySupplyDraft(withdrawn).items[0]).toMatchObject({ class: 'source-only', reasons: ['记录已撤回，不进入安装路径'] })

    const packs = packBatch()
    ;(packs.items as Record<string, unknown>[])[0]!.components = [{ id: 'editor', ref: '@example/editor-tools' }]
    ;(packs.items as Record<string, unknown>[])[0]!.execution = { coverage: 'unknown', edges: [] }
    expect(classifySupplyDraft(packs).items[0]?.class).toBe('unresolved-pack')
  })
})

describe('纯旁路边界', () => {
  it('供货草稿模块不被任何运行时代码引用', async () => {
    const roots = ['packages/market-core/src', 'packages/market/src']
    const offenders: string[] = []
    const walk = async (directoryPath: string): Promise<void> => {
      for (const entry of await readdir(directoryPath, { withFileTypes: true })) {
        const path = join(directoryPath, entry.name)
        if (entry.isDirectory()) { await walk(path); continue }
        if (!/\.(?:ts|tsx)$/u.test(entry.name)) continue
        if (/supply-draft-(?:read|validate|classify)\.ts$/u.test(entry.name)) continue
        const { readFile } = await import('node:fs/promises')
        const text = await readFile(path, 'utf8')
        if (/supply-draft-(?:read|validate|classify)\.ts/u.test(text)) offenders.push(path)
      }
    }
    for (const root of roots) await walk(join(repoRoot, root))
    expect(offenders).toEqual([])
  })
})
