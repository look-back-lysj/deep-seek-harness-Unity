import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as React from 'react'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@official/slot-registry'
import { ClientModuleSystem } from '@official/module-system'
import { parseBootManifest } from '@official/module-manifest'
import { describe, expect, it, vi } from 'vitest'
import { attachDshService } from '../../packages/market/src/client/extensions/dsh.tsx'
import type { ExtensionDefinition } from '../../packages/market/src/client/extensions/contract.ts'
import { makeHost } from './fixtures.ts'

const output = 'D:/eac-market-verify/implementation-20260928/E-extension'
describe('独立tgz的真实Client代码与官方浏览器模块加载器源码（专属配置）', () => {
  it('tar包含真实两入口和bundle层，type-only市场导入已擦除，无网络脚本导入', () => {
    const report = JSON.parse(readFileSync(`${output}/example-package.json`, 'utf8'))
    const files = execFileSync('tar', ['-tf', report.tgz], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)
    expect(files.sort()).toEqual(['package/package.json', 'package/cordis.patch.yml', 'package/README.md', 'package/LICENSE', 'package/lib/index.js', 'package/lib/client.js'].sort())
    const client = execFileSync('tar', ['-xOf', report.tgz, 'package/lib/client.js'], { encoding: 'utf8', windowsHide: true })
    expect(client).toContain('window.__ModuleLoader__.load(')
    expect(client).toContain('eacMarketExtensions')
    expect(client).toContain('requestInstallReview')
    expect(client).not.toMatch(/require\(["']@dsh-eac\/market/)
    expect(client).not.toMatch(/import\(|fetch\(|createElement\(["']script/)
    expect(report.sha256).toBe(createHash('sha256').update(readFileSync(report.tgz)).digest('hex'))
  })
  it('官方ClientModuleSystem加载tgz中的实际bundle并通过真实Cordis等待/登记/卸载', async () => {
    const report = JSON.parse(readFileSync(`${output}/example-package.json`, 'utf8'))
    const pkg = JSON.parse(execFileSync('tar', ['-xOf', report.tgz, 'package/package.json'], { encoding: 'utf8', windowsHide: true }))
    const bundle = execFileSync('tar', ['-xOf', report.tgz, 'package/lib/client.js'], { encoding: 'utf8', windowsHide: true })
    const pendingQueue: unknown[] = []
    const target = { mode: 'queue', pendingQueue, load: (registration: unknown) => { pendingQueue.push(registration) } }
    runInNewContext(bundle, { window: { __ModuleLoader__: target }, console }, { timeout: 1000 })
    const transport = vi.fn(async () => { throw new Error('test forbids network/script transport') })
    const system = new ClientModuleSystem({
      manifest: parseBootManifest({ rev: 'test', entries: [{ id: pkg.name, rev: 'test', url: '/test/client.js?rev=test', inject: pkg.dsh.client.inject }], batches: [{ phase: 'application', url: '/test/client.js?rev=test', rev: 'test', entries: [pkg.name] }] }),
      staticModules: { react: React }, registrationTarget: target, bootstrapModule: { id: 'test.bootstrap', exports: {} }, loadBundle: transport,
    })
    const exports = await system.import(`${pkg.name}/client`) as { apply: (ctx: Context) => void; inject: string[]; definition: ExtensionDefinition }
    expect(exports.definition.contributions).toHaveLength(5)
    const root = new Context(); const slots = await root.plugin(SlotRegistry)
    const ext = await root.plugin({ apply: exports.apply, inject: exports.inject })
    const host = makeHost(); expect(host.getSnapshot()).toHaveLength(0)
    const market = await root.plugin({ inject: ['slots'], apply: (ctx) => attachDshService(ctx, host) })
    for (let i = 0; i < 8; i++) await Promise.resolve()
    expect(host.getSnapshot()).toHaveLength(5); expect(host.getSnapshot().every((e) => e.provider === 'dsh-plugin')).toBe(true)
    expect(transport).not.toHaveBeenCalled()
    await ext.dispose(); expect(host.getSnapshot()).toHaveLength(0)
    await market.dispose(); await slots.dispose()
  })
})
