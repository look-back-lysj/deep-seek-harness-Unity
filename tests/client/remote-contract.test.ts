import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

function readSource(path: string): ts.SourceFile {
  const absolute = fileURLToPath(new URL(path, import.meta.url))
  return ts.createSourceFile(absolute, readFileSync(absolute, 'utf8'), ts.ScriptTarget.Latest, true)
}
function wireType(type: ts.TypeNode | undefined, source: ts.SourceFile): string {
  if (type === undefined) throw new Error('Remote contract must declare its type')
  if (ts.isTypeReferenceNode(type) && type.typeName.getText(source) === 'Promise') {
    return wireType(type.typeArguments?.[0], source)
  }
  return type.getText(source).replace(/\s+/g, '')
}

const model = readSource('../../packages/market/src/client/model.ts')
const adapter = readSource('../../packages/market/src/index.ts')
const activation = readSource('../../packages/market/src/client/activation.ts')
const contract = model.statements.find((node): node is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(node) && node.name.text === 'MarketRemote')!
const service = adapter.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'MarketService')!
const declaration = activation.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations])
  .find(node => node.name.getText(activation) === 'METHOD_ALIASES')!
const aliases = new Map<string, string>()
if (!declaration.initializer || !ts.isObjectLiteralExpression(declaration.initializer)) throw new Error('Remote alias mapping must be explicit')
for (const property of declaration.initializer.properties) {
  if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.initializer)) throw new Error('Unexpected Remote alias property')
  aliases.set(property.name.getText(activation).replace(/^['"]|['"]$/g, ''), property.initializer.text)
}
const methods = new Map(service.members.filter((node): node is ts.MethodDeclaration => ts.isMethodDeclaration(node)
  && (ts.getDecorators(node) ?? []).some(decorator => decorator.expression.getText(adapter) === 'Remote'))
  .map(node => [node.name.getText(adapter), node]))
const clientMethods = contract.members.filter(ts.isMethodSignature)

describe('每个 Client 方法与实际 MarketService Remote 合同一致', () => {
  it.each(clientMethods.map(node => [node.name.getText(model), node] as const))('%s 的别名、参数和结果类型与公开 Remote 一致', (clientName, client) => {
    const wireName = aliases.get(clientName) ?? clientName
    const wire = methods.get(wireName)
    expect(wire, `${clientName} must map to an actual @Remote method, not an internal Backend function`).toBeDefined()
    if (wire === undefined) return
    expect(client.parameters.map(parameter => ({ type: wireType(parameter.type, model), optional: !!parameter.questionToken })))
      .toEqual(wire.parameters.map(parameter => ({ type: wireType(parameter.type, adapter), optional: !!parameter.questionToken })))
    expect(wireType(client.type, model)).toBe(wireType(wire.type, adapter))
  })

  it('现有 Remote 表面都有 Client 声明，不能漏掉新公开的方法或误报数量', () => {
    const mapped = clientMethods.map(node => aliases.get(node.name.getText(model)) ?? node.name.getText(model))
    expect(new Set(mapped).size).toBe(mapped.length)
    expect(mapped.sort()).toEqual([...methods.keys()].sort())
  })
})
