import { describe, expect, it } from 'vitest'
import { ClientSessionGate } from '../../packages/market/src/session-gate.ts'
import { supportsApiVersion } from '../../packages/market-core/src/contracts/compatibility.ts'

describe('adapter/core protocol boundaries', () => {
  it('requires the official peer to negotiate and cannot borrow another connection', () => {
    const gate = new ClientSessionGate('2.0.0')
    expect(() => gate.assert('peer-a')).toThrow('兼容性')
    expect(gate.connect('peer-a', '2.0.0')).toBe(true)
    expect(() => gate.assert('peer-a')).not.toThrow()
    expect(() => gate.assert('peer-b')).toThrow()
    expect(gate.connect('peer-a', '3.0.0')).toBe(false)
    expect(() => gate.assert('peer-a')).toThrow()
  })

  it('expires agreement and bounds connection storage without enabling evicted peers', () => {
    let now = 1_000
    const gate = new ClientSessionGate('2.0.0', () => now)
    gate.connect('old', '2.0.0')
    now += 300_001
    expect(() => gate.assert('old')).toThrow()
    for (let index = 0; index <= 512; index++) gate.connect(`peer-${index}`, '2.0.0')
    expect(() => gate.assert('peer-0')).toThrow()
    expect(() => gate.assert('peer-512')).not.toThrow()
  })

  it('rejects malformed, future-major and unsupported-minor requirements', () => {
    for (const invalid of ['unknown', '2', '02.0.0', '2.0.0-dev', '3.0.0', '2.1.0']) {
      expect(supportsApiVersion('2.0.0', invalid)).toBe(false)
    }
    expect(supportsApiVersion('2.1.0', '2.0.0')).toBe(true)
    expect(supportsApiVersion('2.0.9', '2.0.0')).toBe(true)
  })
})
