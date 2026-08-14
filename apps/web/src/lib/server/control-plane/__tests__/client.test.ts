import { describe, expect, it } from 'vitest'
import { deriveControlPlaneCredential } from '../client'

describe('workspace control-plane credential', () => {
  it('matches the stable per-workspace derivation contract', () => {
    const a = deriveControlPlaneCredential('workspace-a-secret-key-000000000000000000')
    const b = deriveControlPlaneCredential('workspace-b-secret-key-000000000000000000')
    expect(a).toMatch(/^qbint_[A-Za-z0-9_-]{43}$/)
    expect(deriveControlPlaneCredential('workspace-a-secret-key-000000000000000000')).toBe(a)
    expect(a).not.toBe(b)
  })

  it('refuses weak source material', () => {
    expect(() => deriveControlPlaneCredential('short')).toThrow('too short')
  })
})
