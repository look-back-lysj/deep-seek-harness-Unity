#!/usr/bin/env node
/**
 * 供货草稿导入报告（A8）。
 *
 * 用法：node scripts/supply-draft-import.mjs <supply.json路径> [--report <输出目录>] [--artifacts <字节目录>] [--illegal <非法样本>]
 *
 * 只读本地文件、只写 catalog-source/supply-draft/<批次名>/，绝不写 data/ 或 catalog-source/distribution/。
 * 报告项对齐 Mojobox《下游使用指导》第 9 节的九项反馈。
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { readSupplyDraft } from '../packages/market-core/src/catalog/supply-draft-read.ts'
import { validateSupplyDraft } from '../packages/market-core/src/catalog/supply-draft-validate.ts'
import { classifySupplyDraft } from '../packages/market-core/src/catalog/supply-draft-classify.ts'

const IMPORTER_VERSION = 'supply-draft-v0.1.0'
const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const allowedRoot = join(repoRoot, 'catalog-source', 'supply-draft')

function usage(message) {
  console.error(message)
  console.error('用法：node scripts/supply-draft-import.mjs <supply.json路径> [--report <输出目录>] [--artifacts <字节目录>] [--illegal <非法样本路径>]')
  process.exit(2)
}

function parseArgs(argv) {
  const args = { input: undefined, report: undefined, artifacts: undefined, illegal: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--report' || token === '--artifacts' || token === '--illegal') {
      const value = argv[index + 1]
      if (value === undefined) usage(`${token} 缺少取值`)
      args[token.slice(2)] = value
      index += 1
    } else if (args.input === undefined) args.input = token
    else usage(`未知参数：${token}`)
  }
  if (args.input === undefined) usage('缺少供货清单路径')
  return args
}

function safeBatchName(document, fallback) {
  const raw = typeof document?.revision === 'string' && document.revision.trim() !== ''
    ? document.revision
    : typeof document?.sequence === 'number' ? `sequence-${document.sequence}` : fallback
  const cleaned = String(raw).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
  return cleaned === '' ? 'batch-unknown' : cleaned
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function fileDigest(path) {
  const bytes = await readFile(path)
  return { bytes: bytes.byteLength, sha256: sha256(bytes) }
}

function item(id, title, status, note, extra = {}) {
  return { id, title, status, note, ...extra }
}

function typeCounts(items) {
  const counts = {}
  for (const entry of items) counts[entry.type] = (counts[entry.type] ?? 0) + 1
  return counts
}

function classCounts(items) {
  const counts = {}
  for (const entry of items) counts[entry.class] = (counts[entry.class] ?? 0) + 1
  return counts
}

async function verifyArtifacts(document, directory) {
  const missing = []
  const mismatched = []
  let checked = 0
  for (const entry of document.items ?? []) {
    const url = entry?.artifact?.downloadUrl
    if (typeof url !== 'string') continue
    let name
    try { name = basename(new URL(url).pathname) } catch { name = '' }
    if (name === '') { missing.push(`${entry.packageName}@${entry.version}: 下载地址没有文件名`); continue }
    const path = join(directory, name)
    try { await stat(path) } catch { missing.push(`${entry.packageName}@${entry.version}: 字节目录缺少 ${name}`); continue }
    const actual = await fileDigest(path)
    checked += 1
    const expectedDigest = String(entry.artifact.sha256).replace(/^sha256:/, '')
    if (actual.sha256 !== expectedDigest) mismatched.push(`${name}: 摘要不符`)
    else if (actual.bytes !== entry.artifact.size) mismatched.push(`${name}: 大小不符（声明 ${entry.artifact.size}，实际 ${actual.bytes}）`)
  }
  return { checked, missing, mismatched }
}

async function main() {
  const started = performance.now()
  const args = parseArgs(process.argv.slice(2))
  const inputPath = resolve(args.input)

  const read = await readSupplyDraft(inputPath).catch((error) => ({ error }))
  const sample = await fileDigest(inputPath).catch(() => ({ bytes: 0, sha256: '' }))
  const document = read.error === undefined ? read.document : undefined
  const validation = document === undefined ? { ok: false, errors: [read.error.message] } : validateSupplyDraft(document)
  const classification = document === undefined || !validation.ok
    ? { ok: false, errors: validation.errors, items: [] }
    : classifySupplyDraft(document)
  const items = Array.isArray(document?.items) ? document.items : []
  const classified = classification.items
  const counts = { byType: typeCounts(items), byClass: classCounts(classified) }

  const plugins = classified.filter((entry) => entry.type === 'plugin' || entry.type === 'skin')
  const materials = classified.filter((entry) => entry.type === 'material')
  const packs = classified.filter((entry) => entry.type === 'function-pack' || entry.type === 'appearance-pack')
  const sourceOnly = plugins.filter((entry) => entry.class === 'source-only')

  const checks = []
  checks.push(validation.ok
    ? item('1', '读取试点 JSON', 'PASS', `识别 ${items.length} 条记录`, { records: items.length })
    : item('1', '读取试点 JSON', 'FAIL', '读取或校验未通过', { errors: validation.errors }))

  checks.push(plugins.length > 0
    ? item('2', '插件来源展示', 'PASS', `插件/皮肤 ${plugins.length} 条已分类；来源展示 ${sourceOnly.length} 条安装入口结构性关闭，安装候选 ${plugins.length - sourceOnly.length} 条仍需我方其余核对`)
    : item('2', '插件来源展示', 'PENDING', '当前样本没有 plugin/skin 记录，待试点文件'))

  checks.push(materials.length > 0
    ? item('3', '资料展示', 'PASS', `资料 ${materials.length} 条；安装路径拒绝=结构隔离验证于 T4 测试（tests/supply/preview-pack-gate.test.ts）`)
    : item('3', '资料展示', 'PENDING', '当前样本没有 material 记录，待试点文件'))

  checks.push(items.length >= 25
    ? item('4', '读取完整 JSON', 'PASS', `识别 ${items.length} 条记录及其类型 ${JSON.stringify(counts.byType)}`, { byType: counts.byType })
    : item('4', '读取完整 JSON', 'PENDING', `待完整批次文件（当前样本 ${items.length} 条，期望 25 条）`))

  const artifactExpectations = items.filter((entry) => entry?.artifact !== undefined)
  if (args.artifacts === undefined) {
    checks.push(item('5', '薄包字节核对', 'PENDING', `待 14 个薄包字节文件（样本声明 ${artifactExpectations.length} 个 artifact；用 --artifacts <目录> 提供）`))
  } else {
    const verdict = await verifyArtifacts(document, resolve(args.artifacts))
    checks.push(verdict.mismatched.length === 0 && verdict.missing.length === 0 && verdict.checked > 0
      ? item('5', '薄包字节核对', 'PASS', `核对 ${verdict.checked} 个字节文件，摘要与大小一致，不转成插件产物`)
      : item('5', '薄包字节核对', 'FAIL', `已核对 ${verdict.checked} 个；缺失 ${verdict.missing.length}；不符 ${verdict.mismatched.length}`, { missing: verdict.missing, mismatched: verdict.mismatched }))
  }

  checks.push(packs.length > 0
    ? item('6', '未解析组合展示', 'PASS', `组合 ${packs.length} 条按 unresolved-pack 展示，组件与未知执行状态如实显示，一键安装关闭（结构闸见 T4 测试）`)
    : item('6', '未解析组合展示', 'PENDING', '当前样本没有 function-pack / appearance-pack，待完整批次文件'))

  if (args.illegal === undefined) {
    checks.push(item('7', '非法资料 fixture', 'PENDING', '待对方非法资料 fixture（用 --illegal <路径> 提供）'))
  } else {
    const illegal = await readSupplyDraft(resolve(args.illegal)).catch((error) => ({ error }))
    const illegalValidation = illegal.error !== undefined ? { ok: false, errors: [illegal.error.message] } : validateSupplyDraft(illegal.document)
    checks.push(!illegalValidation.ok
      ? item('7', '非法资料 fixture', 'PASS', '已拒绝，未产生任何导入结果', { errors: illegalValidation.errors })
      : item('7', '非法资料 fixture', 'FAIL', '非法样本被接受，导入器校验不足'))
  }

  const duplicateProbe = structuredClone(document ?? {})
  if (Array.isArray(duplicateProbe.items) && duplicateProbe.items.length > 0) {
    duplicateProbe.items.push(structuredClone(duplicateProbe.items[0]))
    const duplicateValidation = validateSupplyDraft(duplicateProbe)
    if (duplicateValidation.ok) {
      checks.push(item('8', '摘要误用/换字节/重复身份', 'FAIL', '重复身份未被拒绝', { errors: duplicateValidation.errors }))
    } else if (args.artifacts === undefined) {
      checks.push(item('8', '摘要误用/换字节/重复身份', 'PENDING', '重复身份已由合成数据验证为拒绝；“格式化后误用原摘要”“同版本换字节”仍待字节文件（--artifacts）', { errors: duplicateValidation.errors }))
    } else {
      const verdict = await verifyArtifacts(document, resolve(args.artifacts))
      checks.push(verdict.mismatched.length === 0 && verdict.checked > 0
        ? item('8', '摘要误用/换字节/重复身份', 'PASS', `重复身份拒绝；${verdict.checked} 个字节文件摘要与大小一致，未静默修正`, { errors: duplicateValidation.errors })
        : item('8', '摘要误用/换字节/重复身份', 'FAIL', '存在摘要或大小不符', { errors: [...duplicateValidation.errors, ...verdict.mismatched] }))
    }
  } else {
    checks.push(item('8', '摘要误用/换字节/重复身份', 'PENDING', '当前样本没有可复制的记录，待文件'))
  }

  checks.push(item('9', '撤回与旧序号等规则', 'PENDING', '批次序号与撤回记录状态机属后续任务；今晚仅由合成数据覆盖类型与结构规则（tests/supply）'))

  const report = {
    importerVersion: IMPORTER_VERSION,
    schemaVersion: typeof document?.schemaVersion === 'string' ? document.schemaVersion : 'unknown',
    sourceId: typeof document?.sourceId === 'string' ? document.sourceId : 'unknown',
    sequence: typeof document?.sequence === 'number' ? document.sequence : null,
    revision: typeof document?.revision === 'string' ? document.revision : null,
    sample: { name: basename(inputPath), bytes: sample.bytes, sha256: sample.sha256 },
    executedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - started),
    ok: validation.ok && classification.ok,
    counts,
    errors: [...validation.errors, ...classification.errors],
    needsPreviewModel: packs.length > 0,
    items: checks,
  }

  const batchName = safeBatchName(document, basename(inputPath).replace(/\W+/g, '-'))
  const finalRoot = resolve(args.report === undefined ? join(allowedRoot, batchName) : args.report)
  if (!isAbsolute(finalRoot)) usage('输出目录必须是绝对路径')
  const rel = relative(repoRoot, finalRoot)
  if (rel.startsWith('..') || isAbsolute(rel)) usage('输出目录必须位于仓库内')
  const normalizedRel = rel.split(sep).join('/')
  if (normalizedRel === 'data' || normalizedRel.startsWith('data/')) usage('禁止写入 data/')
  if (normalizedRel.startsWith('catalog-source/distribution')) usage('禁止写入 catalog-source/distribution/')
  if (args.report === undefined && !normalizedRel.startsWith('catalog-source/supply-draft/')) usage('输出目录必须位于 catalog-source/supply-draft 之内')

  await mkdir(finalRoot, { recursive: true })
  await writeFile(join(finalRoot, 'report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8')

  const width = Math.max(...checks.map((entry) => entry.title.length), 6)
  console.log(`EAC 供货草稿导入报告 · ${IMPORTER_VERSION}`)
  console.log(`样本 ${report.sample.name} · ${report.sample.bytes} 字节 · SHA-256 ${report.sample.sha256}`)
  console.log(`批次 ${report.revision ?? '-'} · 序号 ${report.sequence ?? '-'} · 用时 ${report.durationMs}ms`)
  console.log('-'.repeat(width + 46))
  for (const entry of checks) {
    console.log(`${entry.title.padEnd(width, '　')}  ${entry.status.padEnd(7)}  ${entry.note}`)
  }
  console.log('-'.repeat(width + 46))
  const failed = checks.filter((entry) => entry.status === 'FAIL')
  const pending = checks.filter((entry) => entry.status === 'PENDING')
  console.log(`通过 ${checks.length - failed.length - pending.length} · 失败 ${failed.length} · 待文件 ${pending.length}`)
  console.log(`报告：${join(rel, 'report.json')}`)

  if (pending.length === 0 && failed.length === 0) {
    const comment = [
      `## 供货草稿导入反馈（${IMPORTER_VERSION}）`,
      '',
      `- Schema：\`${report.schemaVersion}\`，来源 \`${report.sourceId}\`，序号 \`${report.sequence}\`，批次 \`${report.revision}\``,
      `- 样本：\`${report.sample.name}\` · ${report.sample.bytes} 字节 · SHA-256 \`${report.sample.sha256}\``,
      `- 导入器版本：\`${report.importerVersion}\`（代码固定字符串，非安全认证）`,
      `- 记录数：${items.length}，类型分布 ${JSON.stringify(counts.byType)}，分类 ${JSON.stringify(counts.byClass)}`,
      `- 是否需要新增纯展示模型：${report.needsPreviewModel ? '是（未解析组合按 previewPacks 纯展示接入）' : '否'}`,
      '',
      '| 检查 | 结果 | 说明 |',
      '| --- | --- | --- |',
      ...checks.map((entry) => `| ${entry.title} | ${entry.status} | ${entry.note.replace(/\|/g, '\\|')} |`),
      '',
    ].join('\n')
    await writeFile(join(finalRoot, 'report-comment.md'), comment, 'utf8')
    console.log(`评论稿：${join(rel, 'report-comment.md')}`)
  } else {
    console.log('未生成 issue 评论稿：仍有待文件或失败项。')
  }
  if (failed.length > 0) process.exitCode = 1
}

await main()
