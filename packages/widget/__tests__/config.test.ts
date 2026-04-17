import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchServerConfig } from '../src/core/config'

describe('config.fetchServerConfig', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches and returns theme from /api/widget/config.json', async () => {
    const mock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ theme: { lightPrimary: '#ff0000' } }),
    }))
    vi.stubGlobal('fetch', mock)
    const cfg = await fetchServerConfig('https://feedback.acme.com')
    expect(mock).toHaveBeenCalledWith('https://feedback.acme.com/api/widget/config.json')
    expect(cfg.theme?.lightPrimary).toBe('#ff0000')
  })

  it('returns empty config if fetch is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({}) }))
    )
    const cfg = await fetchServerConfig('https://feedback.acme.com')
    expect(cfg).toEqual({})
  })

  it('swallows network errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      })
    )
    const cfg = await fetchServerConfig('https://feedback.acme.com')
    expect(cfg).toEqual({})
  })
})
