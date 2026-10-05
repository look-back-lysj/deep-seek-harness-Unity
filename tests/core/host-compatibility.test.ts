import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import type { CatalogCoreRangeDeclaration, CatalogHostRequirements, CoreCompatibilityReason, HostCoreSnapshot } from '../../packages/market-core/src/contracts/types.ts'
import { evaluateHostCompatibility } from '../../packages/market-core/src/core/host-compatibility.ts'

const engine = createRequire(new URL('../../packages/market-core/package.json', import.meta.url))('semver') as {
  satisfies(version: string, range: string): boolean
  compare(left: string, right: string): number
  intersects(left: string, right: string): boolean
}

function host(version: string | null = '1.2.3', overrides: Partial<HostCoreSnapshot> = {}): HostCoreSnapshot {
  return { agentId: 'dsh', agentName: 'DSH fixture', version, versionScheme: 'semver', status: version === null ? 'unknown' : 'known', hostRevision: 'fixture-host', source: 'synthetic', ...overrides }
}

function declaration(range: string | null, overrides: Partial<CatalogCoreRangeDeclaration> = {}): CatalogCoreRangeDeclaration {
  return { agentId: 'dsh', range, versionScheme: 'npm', origin: 'agent-forge-target', metadataDigest: 'fixture-digest', ...overrides }
}

function requirements(...ranges: (string | null)[]): CatalogHostRequirements {
  return { historyCoverage: 'latest-only', declarations: ranges.map(range => declaration(range)) }
}

function result(version: string, ranges: string[], reason?: CoreCompatibilityReason) {
  expect(evaluateHostCompatibility(host(version), requirements(...ranges))).toEqual({
    status: reason === undefined ? 'compatible' : reason === 'metadata-conflict' ? 'conflict' : 'incompatible',
    ...(reason === undefined ? {} : { reason }), declaredRanges: ranges,
  })
}

describe('HC-2 宿主完整范围纯评估器', () => {
  it.each([
    ['1.2.3', '^1.2.0'], ['0.2.9', '^0.2.0'], ['0.0.3', '^0.0.3'],
    ['1.2.9', '~1.2.3'], ['2.3.4', '1.2.3 - 2.3.4'], ['2.3.99', '1.2 - 2.3'],
    ['3.1.0', '^1.0.0 || ^3.0.0'], ['1.2.3', '>1.2.2 <1.2.4'],
    ['1.2.3', '>=1.2.3 <=1.2.3'], ['20.0.0', '*'], ['1.9.0', '1.x'],
    ['1.2.3+build.7', '=1.2.3'],
    ['0.2.0-rc.1', '0.2.0-rc.1 || ^0.2.0'], ['1.2.3-beta.2', '>=1.2.3-beta.1 <1.2.3'],
    ['1.2.3-beta.1.0', '>1.2.3-beta.1 <1.2.3-beta.2'], ['0.0.0-0', '>=0.0.0-0 <0.0.0'],
  ])('严格匹配 %s / %s', (version, range) => { result(version, [range]) })

  it.each([
    ['1.2.2', '^1.2.3', 'core-too-old'], ['1.3.0', '~1.2.3', 'core-too-new'],
    ['1.2.3', '>1.2.3', 'core-too-old'], ['1.2.3', '<1.2.3', 'core-too-new'],
    ['3.0.0', '>=2.0.0 <3.0.0', 'core-too-new'],
    ['2.5.0', '>=1.0.0 <2.0.0 || >=3.0.0 <4.0.0', 'core-range-mismatch'],
    ['0.5.0', '^1.0.0 || ^3.0.0', 'core-too-old'], ['5.0.0', '^1.0.0 || ^3.0.0', 'core-too-new'],
    ['1.5.0-beta.1', '^1.0.0', 'core-range-mismatch'], ['1.0.0-beta.1', '^1.0.0', 'core-range-mismatch'],
    ['1.0.0-beta.1', '*', 'core-range-mismatch'], ['1.3.0-beta.1', '>=1.2.3-beta.1 <2.0.0', 'core-range-mismatch'],
    ['1.2.3-beta.1', '>=1.2.3-beta.2 <1.2.3', 'core-too-old'],
    ['1.2.3', '>=1.2.3-beta.2 <1.2.3', 'core-too-new'],
    ['0.1.0', '<0.0.0-0 || >=2.0.0', 'core-too-old'],
    ['4.0.0', '>2.0.0 <2.0.1 || ^1.0.0', 'core-too-new'],
  ] as const)('证明边界或空洞 %s / %s', (version, range, reason) => { result(version, [range], reason) })

  it.each([
    ['1.5.0', ['^1.0.0', '>=1.0.0 <2.0.0']],
    ['1.7.0', ['>=1.0.0 <3.0.0', '>=1.5.0 <2.0.0']],
    ['1.2.3', ['1.2.3+first', '=1.2.3+second']],
    ['2.0.0', ['>=1.0.0 <=2.0.0', '>=2.0.0 <3.0.0']],
    ['3.2.0', ['^1.0.0 || ^3.0.0', '>=3.0.0 <3.5.0']],
    ['1.2.3-beta.2', ['>=1.2.3-beta.1 <2.0.0', '>=1.2.3-beta.2 <1.2.3']],
  ])('等价或部分交集 %s / %j', (version, ranges) => { result(version, ranges) })

  it.each([
    ['1.0.0', ['<1.0.0', '>=1.0.0']],
    ['1.5.0', ['^1.0.0 || ^3.0.0', '^2.0.0']],
    ['1.0.0', ['^1.0.0 || ^2.0.0', '^2.0.0 || ^3.0.0', '^1.0.0 || ^3.0.0']],
    ['1.0.0', ['>1.0.0 <1.0.1']], ['0.0.0', ['<0.0.0-0']],
    ['1.0.0', ['>=2.0.0 <1.0.0']], ['1.2.3', ['>1.2.3-beta.1 <1.2.3-beta.1.0']],
    ['1.2.3', ['>=1.2.3-beta.1 <1.2.3', '*']],
    ['1.2.3', ['>=1.2.3-beta.1 <1.2.3', '>=1.2.4-beta.1 <1.2.4']],
  ])('合法空集或不相交不能报过旧/过新 %s / %j', (version, ranges) => { result(version, ranges, 'metadata-conflict') })

  it('方向必须依据实际交集，不按单条范围的结果猜测', () => {
    result('2.5.0', ['^1.0.0 || ^3.0.0', '>=2.0.0'], 'core-too-old')
    result('2.5.0', ['^1.0.0 || ^3.0.0', '<3.0.0'], 'core-too-new')
    result('1.2.3-beta.1', ['>=1.2.3-beta.2 <1.2.3', '>=1.2.3-beta.1 <1.2.3'], 'core-too-old')
  })

  it('保留原始声明，不修改输入或拿 Evidence 推断范围', () => {
    const input = { ...requirements('^1.0.0', '>=1.0.0 <2.0.0'), verification: 'hard-incompatible' }
    const before = structuredClone(input)
    expect(evaluateHostCompatibility(host(), input)).toEqual({ status: 'compatible', declaredRanges: ['^1.0.0', '>=1.0.0 <2.0.0'] })
    expect(input).toEqual(before)
    const verified = { ...requirements(null), verification: 'verified' }
    expect(evaluateHostCompatibility(host(), verified)).toMatchObject({ status: 'unknown', reason: 'core-range-unknown' })
  })

  it('缺少范围、null、非法范围都明确未知', () => {
    expect(evaluateHostCompatibility(host())).toEqual({ status: 'unknown', reason: 'core-range-unknown', declaredRanges: [] })
    for (const ranges of [[], [null], ['^1.0.0', null]]) {
      expect(evaluateHostCompatibility(host(), requirements(...ranges))).toMatchObject({ status: 'unknown', reason: 'core-range-unknown' })
    }
    for (const range of ['not-a-version-range', '>=01.2.3', '^1.0.0 || broken', '=>1.2.3']) {
      expect(evaluateHostCompatibility(host(), requirements(range))).toEqual({ status: 'unknown', reason: 'core-range-invalid', declaredRanges: [range] })
    }
  })

  it('宿主未知或精确版本非法，不进行 coerce', () => {
    expect(evaluateHostCompatibility(host(null), requirements('*'))).toMatchObject({ status: 'unknown', reason: 'core-version-unknown' })
    expect(evaluateHostCompatibility(host('1.2.3', { status: 'unknown' }), requirements('*'))).toMatchObject({ reason: 'core-version-unknown' })
    for (const version of ['v1.2.3', '=1.2.3', ' 1.2.3 ', '1.2', '01.2.3', '1.2.3-01', '1.2.3.4', '']) {
      expect(evaluateHostCompatibility(host(version), requirements('*'))).toMatchObject({ status: 'unknown', reason: 'core-version-invalid' })
    }
  })

  it.each(['npm', 'semver'] as const)('仅支持 %s scheme', scheme => {
    expect(evaluateHostCompatibility(host('1.2.3', { versionScheme: scheme }), { ...requirements('*'), declarations: [declaration('*', { versionScheme: scheme })] }).status).toBe('compatible')
  })

  it.each([undefined, 'unknown', 'pep440', 'calver', 'date', 'custom'] as const)('区分未知与不支持 scheme %s', scheme => {
    const expected = scheme === undefined || scheme === 'unknown' ? 'unknown' : 'unsupported'
    const currentHost = host()
    const currentDeclaration = declaration('*')
    if (scheme === undefined) {
      const { versionScheme: _hostScheme, ...withoutHostScheme } = currentHost
      const { versionScheme: _rangeScheme, ...withoutRangeScheme } = currentDeclaration
      expect(evaluateHostCompatibility(withoutHostScheme, requirements('*'))).toMatchObject({ status: 'unknown', reason: `core-version-scheme-${expected}` })
      expect(evaluateHostCompatibility(currentHost, { historyCoverage: 'unknown', declarations: [withoutRangeScheme] })).toMatchObject({ status: 'unknown', reason: `core-range-scheme-${expected}` })
    } else {
      expect(evaluateHostCompatibility(host('1.2.3', { versionScheme: scheme }), requirements('*'))).toMatchObject({ status: 'unknown', reason: `core-version-scheme-${expected}` })
      expect(evaluateHostCompatibility(currentHost, { historyCoverage: 'unknown', declarations: [declaration('*', { versionScheme: scheme })] })).toMatchObject({ status: 'unknown', reason: `core-range-scheme-${expected}` })
    }
  })

  it('身份没有绑定时不猜，只有另一个 Agent 时明确 mismatch', () => {
    for (const agentId of [null, '', '   ']) {
      expect(evaluateHostCompatibility(host('1.2.3', { agentId }), requirements('*'))).toMatchObject({ status: 'unknown', reason: 'core-version-unknown' })
    }
    expect(evaluateHostCompatibility(host(), { historyCoverage: 'unknown', declarations: [declaration('*', { agentId: '' })] })).toMatchObject({ status: 'unknown', reason: 'core-range-unknown' })
    expect(evaluateHostCompatibility(host(), { historyCoverage: 'unknown', declarations: [declaration('broken', { agentId: 'other', versionScheme: 'custom' })] })).toEqual({ status: 'incompatible', reason: 'target-agent-mismatch', declaredRanges: ['broken'] })
  })

  it('另一个 Agent 的非法范围、null 和 scheme 不污染匹配目标', () => {
    expect(evaluateHostCompatibility(host(), { historyCoverage: 'partial', declarations: [
      declaration('broken', { agentId: 'other', versionScheme: 'custom' }), declaration(null, { agentId: 'other', versionScheme: 'unknown' }), declaration('^1.0.0'),
    ] })).toEqual({ status: 'compatible', declaredRanges: ['^1.0.0'] })
  })

  it('超大数字不能利用引擎的精度损失伪造相等，不能崩溃', () => {
    for (const version of ['9007199254740992.0.0', '1.9007199254740992.0', '1.0.9007199254740992', '1.0.0-9007199254740992', '1.0.0-' + '9'.repeat(300)]) {
      expect(evaluateHostCompatibility(host(version), requirements('*'))).toMatchObject({ status: 'unknown', reason: 'core-version-invalid' })
    }
    for (const range of ['>=9007199254740992.0.0', '>=1.0.0-9007199254740992']) {
      expect(evaluateHostCompatibility(host(), requirements(range))).toMatchObject({ status: 'unknown', reason: 'core-range-invalid' })
    }
    result('9007199254740991.0.0', ['9007199254740991.0.0'])
    result('1.0.0-9007199254740991', ['1.0.0-9007199254740991'])
    expect(evaluateHostCompatibility(host(), requirements('>9007199254740991.9007199254740991.9007199254740991'))).toMatchObject({ status: 'unknown', reason: 'core-range-evaluation-limited' })
  })

  it('分支证明预算耗尽安全未知，不伪造交集或方向', () => {
    const branches = Array.from({ length: 65 }, (_, index) => `=${index}.0.0`).join(' || ')
    expect(evaluateHostCompatibility(host('100.0.0'), requirements(branches, branches))).toMatchObject({ status: 'unknown', reason: 'core-range-evaluation-limited' })
  })

  it.each(['', ' ', '\t'])('空白声明 %j 不自动解释为通配范围', range => {
    expect(engine.satisfies('8.0.0', range)).toBe(true)
    expect(evaluateHostCompatibility(host(), requirements(range))).toMatchObject({ status: 'unknown', reason: 'core-range-invalid' })
  })

  it('有界求值限制保留独立原因，不把缺数据和资源限额混为一谈', () => {
    expect(evaluateHostCompatibility(host(), requirements(' '.repeat(4096) + '*'))).toMatchObject({ status: 'unknown', reason: 'core-range-evaluation-limited' })
    expect(evaluateHostCompatibility(host(), requirements(...Array.from({ length: 129 }, () => '*')))).toMatchObject({ status: 'unknown', reason: 'core-range-evaluation-limited' })
  })

  it('独立引擎探针确认 intersects 不能作为空集证明', () => {
    expect(engine.intersects('>1.0.0 <1.0.1', '*')).toBe(true)
    result('1.0.0', ['>1.0.0 <1.0.1', '*'], 'metadata-conflict')
  })

  it('预发行通道对每条声明独立生效，不因拼接比较器而扩大交集', () => {
    result('1.2.3-beta.2', ['>=1.2.3-beta.1 <2.0.0', '>=1.0.0 <2.0.0'], 'core-range-mismatch')
    result('1.2.3-beta.1', ['>=1.2.3-beta.2 <1.2.3 || ^2.0.0', '>=1.2.3-beta.1 <1.2.3 || ^2.0.0'], 'core-too-old')
    result('1.2.3', ['>=1.2.3-beta.2 <1.2.3 || ^2.0.0', '>=1.2.3-beta.1 <1.2.3 || ^2.0.0'], 'core-range-mismatch')
    result('0.0.0', ['>=0.0.0-0 <0.0.0', '*'], 'metadata-conflict')
  })

  it('只有空分支或互斥分支包含预发行标记，不能当成真实准入', () => {
    result('1.0.0-beta', ['>1.0.0-beta <1.0.0-beta.0 || ^1.0.0'], 'core-range-mismatch')
    result('1.0.0-alpha.0', ['>=1.0.0-alpha <1.0.0-beta || ^1.0.0', '>=1.0.0-rc <1.0.0 || ^1.0.0'], 'core-range-mismatch')
  })

  it('稳定版见证跨大号 patch/minor 边界安全进位', () => {
    result('1.9007199254740991.9007199254740991', ['>1.9007199254740991.9007199254740991 <2.0.1'], 'core-too-old')
    result('1.0.9007199254740991', ['>1.0.9007199254740991 <1.1.1'], 'core-too-old')
  })

  it.each(['0.0.0', '1.0.0', '1.1.0', '1.2.0', '2.0.0', '3.0.0'])('有限精确允许集的独立 oracle：宿主 %s', version => {
    const versions = ['1.0.0-alpha', '1.0.0', '1.1.0-beta', '1.1.0', '2.0.0']
    const ranges = [
      '1.0.0', '1.1.0', '2.0.0', '1.0.0-alpha', '1.1.0-beta',
      '1.0.0 || 2.0.0', '1.0.0-alpha || 1.1.0-beta', '1.0.0-alpha || 1.0.0',
    ]
    for (const left of ranges) {
      for (const right of ranges) {
        const allowed = versions.filter(candidate => engine.satisfies(candidate, left) && engine.satisfies(candidate, right))
        const reason = allowed.length === 0 ? 'metadata-conflict' : allowed.includes(version) ? undefined
          : allowed.every(candidate => engine.compare(candidate, version) > 0) ? 'core-too-old'
            : allowed.every(candidate => engine.compare(candidate, version) < 0) ? 'core-too-new' : 'core-range-mismatch'
        result(version, [left, right], reason)
      }
    }
  })
})

interface RangeFixture {
  id: string
  input: { hostVersion: string | null; releases: { range: string | null; targetAgentId?: string }[] }
  expected: { latestCompatibilityReason?: CoreCompatibilityReason; excludedReason?: CoreCompatibilityReason; compatibility?: string }
}

const fixture = JSON.parse(readFileSync(new URL('../../docs/handoff/fixtures/host-core-compatibility-cases.v1.json', import.meta.url), 'utf8')) as { cases: RangeFixture[] }
const rangeProbeIds = ['VC01', 'VC02', 'VC04', 'VC05', 'VC06', 'VC07', 'VC08', 'VC09', 'VC10', 'VC14']

describe('实际加载规划 fixture，仅验证列出的范围 probe（不验版本列表/Client/写入）', () => {
  it.each(rangeProbeIds)('%s 范围场景', id => {
    const scenario = fixture.cases.find(entry => entry.id === id)
    expect(scenario, `fixture 缺少 ${id}`).toBeDefined()
    const release = scenario!.input.releases[0]!
    const evaluation = evaluateHostCompatibility(host(scenario!.input.hostVersion), {
      historyCoverage: 'latest-only', declarations: [declaration(release.range, { agentId: release.targetAgentId ?? 'dsh' })],
    })
    const reason = scenario!.expected.latestCompatibilityReason ?? scenario!.expected.excludedReason
    if (reason !== undefined) expect(evaluation.reason).toBe(reason)
    else expect(evaluation.status).toBe(scenario!.expected.compatibility ?? 'compatible')
    if (evaluation.status !== 'compatible') expect(evaluation.reason).toBeDefined()
  })
})
