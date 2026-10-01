import { describe, expect, it } from 'vitest'
import {
  buildBundleSelectionGraph,
  cancelSelection,
  selectionDependencies,
  selectionDependents,
  validateSelectionGraph,
} from '../../packages/market-core/src/catalog/bundle-selection.ts'
import type { BundleSelectionGraph } from '../../packages/market-core/src/contracts/types.ts'

function graph(): BundleSelectionGraph {
  return {
    revision: 'test-revision', rootId: 'root',
    nodes: [
      { id: 'root', kind: 'bundle', optional: true, selected: false, dependencies: [] },
      { id: 'base', kind: 'dependency', pluginId: 'base', packageName: 'base', optional: true, selected: false, dependencies: [] },
      { id: 'child', kind: 'plugin', pluginId: 'child', packageName: 'child', optional: true, selected: true, dependencies: ['base'] },
      { id: 'grandchild', kind: 'plugin', pluginId: 'grandchild', packageName: 'grandchild', optional: true, selected: true, dependencies: ['child'] },
    ],
    edges: [{ prerequisiteId: 'base', consumerId: 'child', milestone: 'installed' }, { prerequisiteId: 'child', consumerId: 'grandchild', milestone: 'installed' }],
  }
}

describe('bundle selection graph', () => {
  it('expands nested bundles and leaves every member optional', () => {
    const result = buildBundleSelectionGraph([
      { id: 'root', kind: 'bundle', members: ['nested', 'leaf'] },
      { id: 'nested', kind: 'bundle', members: ['plugin'] },
      { id: 'plugin', kind: 'plugin', packageName: 'plugin', version: '1.0.0' },
      { id: 'leaf', kind: 'plugin' },
    ], 'root', 'r1')
    expect(result.validation.valid).toBe(true)
    expect(result.graph.nodes.map(node => node.id)).toEqual(['root', 'nested', 'plugin', 'leaf'])
    expect(result.graph.nodes.every(node => node.optional === true && node.selected === false)).toBe(true)
    expect(result.graph.nodes.find(node => node.id === 'plugin')?.parentId).toBe('nested')
  })

  it('reports cycles and missing references without making them installable', () => {
    const result = buildBundleSelectionGraph([
      { id: 'a', kind: 'bundle', dependencies: ['b'] },
      { id: 'b', kind: 'bundle', dependencies: ['a', 'missing'] },
    ], 'a')
    expect(result.validation.valid).toBe(false)
    expect(result.validation.errors.some(error => error.startsWith('dependency-cycle:'))).toBe(true)
    expect(result.validation.errors).toContain('missing-prerequisite:b->missing')
  })

  it('blocks ordinary cancellation and lists direct/transitive dependents', () => {
    expect(selectionDependencies(graph(), 'grandchild').map(node => node.id)).toEqual(['child', 'base'])
    expect(selectionDependents(graph(), 'base').map(node => node.id)).toEqual(['child', 'grandchild'])
    const result = cancelSelection(graph(), 'base')
    expect(result.status).toBe('blocked')
    expect(result.dependentPackages).toEqual(['child', 'grandchild'])
    expect(result.cascadedCancelled).toEqual([])
    expect(result.preservedPackages[0]?.reasons).toContain('has-selected-dependent')
  })

  it('force-cancels the current chain but preserves external and completed items with reasons', () => {
    const result = cancelSelection(graph(), 'base', {
      force: true,
      context: { completedPackageIds: ['grandchild'], explicitPackageIds: ['child'] },
    })
    expect(result.status).toBe('blocked')
    expect(result.cascadedCancelled).toEqual([])
    expect(result.preservedPackages.map(item => item.packageName)).toEqual(expect.arrayContaining(['base', 'child', 'grandchild']))
    expect(result.reasons.join(' ')).toContain('explicit')
  })

  it('rejects a graph with non-optional nodes', () => {
    const invalid = { ...graph(), nodes: graph().nodes.map(node => node.id === 'base' ? { ...node, optional: false as true } : node) }
    expect(validateSelectionGraph(invalid).errors).toContain('non-optional:base')
  })
})
