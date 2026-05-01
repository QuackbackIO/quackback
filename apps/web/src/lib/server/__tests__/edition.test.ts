import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('edition', () => {
  beforeEach(() => {
    delete process.env.EDITION
    vi.resetModules()
  })

  it('defaults to oss when EDITION is unset', async () => {
    const { EDITION, IS_CLOUD } = await import('../edition')
    expect(EDITION).toBe('oss')
    expect(IS_CLOUD).toBe(false)
  })

  it('returns cloud when EDITION=cloud', async () => {
    process.env.EDITION = 'cloud'
    const { EDITION, IS_CLOUD } = await import('../edition')
    expect(EDITION).toBe('cloud')
    expect(IS_CLOUD).toBe(true)
  })

  it('falls back to oss for any unrecognised value', async () => {
    process.env.EDITION = 'enterprise'
    const { EDITION, IS_CLOUD } = await import('../edition')
    expect(EDITION).toBe('oss')
    expect(IS_CLOUD).toBe(false)
  })

  it('falls back to oss for empty string', async () => {
    process.env.EDITION = ''
    const { EDITION, IS_CLOUD } = await import('../edition')
    expect(EDITION).toBe('oss')
    expect(IS_CLOUD).toBe(false)
  })
})
