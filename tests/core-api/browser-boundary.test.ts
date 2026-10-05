import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import * as root from '../../packages/market-core/src/index.ts'

const sourceRoot = fileURLToPath(new URL('../../packages/market-core/src/', import.meta.url))

describe('浏览器安全入口与显式 API', () => {
  it('根入口和 API 的完整导入图不依赖 Node、DSH 或后台实现（包含类型依赖）', () => {
    const visited = new Set<string>()
    function visit(path: string): void {
      if (visited.has(path)) return
      visited.add(path)
      const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
      const walk = (node: ts.Node): void => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
          expect(ts.isStringLiteral(node.moduleSpecifier)).toBe(true)
          const target = (node.moduleSpecifier as ts.StringLiteral).text
          expect(target, path).toMatch(/^\./)
          const dependency = resolve(dirname(path), target)
          expect(dependency.replaceAll('\\', '/')).toMatch(/\/src\/(contracts\/[^/]+|api)\.ts$/)
          visit(dependency)
        }
        if (ts.isCallExpression(node)) expect(node.expression.getText(source)).not.toMatch(/^(import|require)$/)
        ts.forEachChild(node, walk)
      }
      walk(source)
    }
    visit(resolve(sourceRoot, 'index.ts'))
    visit(resolve(sourceRoot, 'api.ts'))
    expect(visited.size).toBeGreaterThanOrEqual(4)
    expect(root.CORE_VERSION).toBe('0.1.6')
    expect(root.supportsApiVersion(root.CORE_API_VERSION, '1.0.0')).toBe(true)
    expect(root).not.toHaveProperty('MarketRuntime')
    expect(root).not.toHaveProperty('createDshMarketBackend')
  })

  it('接口显式覆盖原运行时的所有公开业务方法，四个 callerId 无可选或默认值', () => {
    const api = ts.createSourceFile('api.ts', readFileSync(resolve(sourceRoot, 'api.ts'), 'utf8'), ts.ScriptTarget.Latest, true)
    const runtime = ts.createSourceFile('runtime.ts', readFileSync(resolve(sourceRoot, 'host/market-runtime.ts'), 'utf8'), ts.ScriptTarget.Latest, true)
    const contract = api.statements.find((node): node is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(node) && node.name.text === 'MarketBackend')!
    const implementation = runtime.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'MarketRuntime')!
    const names = contract.members.map(node => node.name!.getText(api))
    const methods = implementation.members.filter(node => ts.isMethodDeclaration(node)
      && !node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.PrivateKeyword)
      && node.name?.getText(runtime) !== 'catalogView')
    const runtimeMethods = [...new Set([...methods.map(node => node.name!.getText(runtime)), 'capabilities', 'catalog', 'inventory',
      'catalogSources', 'agentForgeRefresh', 'maintenanceStatus', 'checkUpdates', 'updatePolicyGet', 'updatePolicySave'])]
    expect(names.sort()).toEqual(runtimeMethods.sort())
    expect(names).toHaveLength(37)
    for (const name of ['planCreate', 'taskStart', 'aiAnalyze', 'aiConfirm']) {
      const method = contract.members.find(node => node.name!.getText(api) === name) as ts.MethodSignature
      const caller = method.parameters[1]!
      expect(caller.name.getText(api)).toBe('callerId')
      expect(caller.questionToken).toBeUndefined()
      expect(caller.initializer).toBeUndefined()
      expect(caller.type?.getText(api)).toBe('string')
    }
    expect(contract.members.find(node => node.name!.getText(api) === 'planCreate')!.getText(api)).not.toContain('preferredSource')
  })
})
