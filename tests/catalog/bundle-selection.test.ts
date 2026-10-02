import { describe, expect, it } from 'vitest'
import {
  buildBundleSelectionGraph,
  buildAgentForgeBundleSelectionGraph,
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



  it('converts Agent Forge memberId/memberType records and blocks missing members', () => {
    const result = buildAgentForgeBundleSelectionGraph([
      { schemaVersion: 2, id: 'root-id', name: '@test/root', version: '1.0.0', type: 'bundle', bundleDetails: { members: [{ memberId: 'plugin-id', memberType: 'package' }] } },
      { schemaVersion: 2, id: 'plugin-id', name: '@test/plugin', version: '2.0.0', type: 'plugin' },
    ], 'root-id', 'af-r1')
    expect(result.validation.valid).toBe(true)
    expect(result.graph.nodes.map(node => node.id)).toEqual(['root-id', 'plugin-id'])
    expect(result.graph.nodes.find(node => node.id === 'plugin-id')).toMatchObject({ packageName: '@test/plugin', version: '2.0.0', parentId: 'root-id' })
    const missing = buildAgentForgeBundleSelectionGraph([
      { schemaVersion: 2, id: 'root-id', name: '@test/root', version: '1.0.0', type: 'bundle', bundleDetails: { members: [{ memberId: 'gone', memberType: 'package' }] } },
    ], 'root-id')
    expect(missing.validation.valid).toBe(false)
    expect(missing.validation.errors).toContain('missing-member:root-id->gone')
  })

  it('blocks Agent Forge dependency cycles and repeated Bundle members', () => {
    const dependencyCycle = buildAgentForgeBundleSelectionGraph([
      { schemaVersion: 2, id: 'bundle', name: '@test/bundle', version: '1.0.0', type: 'bundle', bundleDetails: { members: [{ memberId: 'a', memberType: 'package' }] } },
      { schemaVersion: 2, id: 'a', name: '@test/a', version: '1.0.0', type: 'plugin', dependencies: [{ id: 'b' }] },
      { schemaVersion: 2, id: 'b', name: '@test/b', version: '1.0.0', type: 'plugin', dependencies: [{ id: 'a' }] },
    ], 'bundle')
    expect(dependencyCycle.validation.valid).toBe(false)
    expect(dependencyCycle.validation.errors.some(error => error.startsWith('dependency-cycle:'))).toBe(true)
    const duplicateMember = buildAgentForgeBundleSelectionGraph([
      { schemaVersion: 2, id: 'bundle', name: '@test/bundle', version: '1.0.0', type: 'bundle', bundleDetails: { members: [{ memberId: 'a', memberType: 'package' }, { memberId: 'a', memberType: 'package' }] } },
      { schemaVersion: 2, id: 'a', name: '@test/a', version: '1.0.0', type: 'plugin' },
    ], 'bundle')
    expect(duplicateMember.validation.valid).toBe(false)
    expect(duplicateMember.validation.errors).toContain('duplicate-member:bundle->a')
  })

  it('blocks nested bundle member cycles and duplicate record identities', () => {
    const cyclic = buildAgentForgeBundleSelectionGraph([
      { schemaVersion: 2, id: 'a', name: '@test/a', version: '1.0.0', type: 'bundle', bundleDetails: { members: [{ memberId: 'b', memberType: 'bundle' }] } },
      { schemaVersion: 2, id: 'b', name: '@test/b', version: '1.0.0', type: 'bundle', bundleDetails: { members: [{ memberId: 'a', memberType: 'bundle' }] } },
    ], 'a')
    expect(cyclic.validation.valid).toBe(false)
    expect(cyclic.validation.errors.some(error => error.startsWith('bundle-member-cycle:'))).toBe(true)
    const duplicate = buildAgentForgeBundleSelectionGraph([
      { schemaVersion: 2, id: 'a', name: '@test/a', version: '1.0.0', type: 'bundle', bundleDetails: { members: [{ memberId: 'b', memberType: 'package' }] } },
      { schemaVersion: 2, id: 'b', name: '@test/b', version: '1.0.0', type: 'plugin' },
      { schemaVersion: 2, id: 'b', name: '@test/other', version: '1.0.0', type: 'plugin' },
    ], 'a')
    expect(duplicate.validation.valid).toBe(false)
    expect(duplicate.validation.errors).toContain('duplicate-package-id:b')
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
