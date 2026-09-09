import { describe, it, expect, vi } from 'vitest'
import { NotFoundError } from '@/lib/shared/errors'
import { withDefaultLocaleFallback } from '../article-locale'

describe('withDefaultLocaleFallback', () => {
  it('returns the requested locale when present', async () => {
    const load = vi.fn(async (locale: string) => locale)
    await expect(withDefaultLocaleFallback('de', 'en', load, () => false)).resolves.toBe('de')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('falls back to the default locale when the requested translation is missing', async () => {
    const load = vi.fn(async (locale: string) => {
      if (locale === 'de') throw new NotFoundError('ARTICLE_NOT_FOUND', 'missing')
      return 'en-article'
    })
    await expect(
      withDefaultLocaleFallback('de', 'en', load, (err) => err instanceof NotFoundError)
    ).resolves.toBe('en-article')
    expect(load).toHaveBeenCalledWith('de')
    expect(load).toHaveBeenCalledWith('en')
  })

  it('does not retry when already on the default locale', async () => {
    const err = new NotFoundError('ARTICLE_NOT_FOUND', 'missing')
    const load = vi.fn(async () => {
      throw err
    })
    await expect(
      withDefaultLocaleFallback('en', 'en', load, (e) => e instanceof NotFoundError)
    ).rejects.toBe(err)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('rethrows errors that are not a missing translation', async () => {
    const err = new Error('db down')
    const load = vi.fn(async () => {
      throw err
    })
    await expect(
      withDefaultLocaleFallback('de', 'en', load, (e) => e instanceof NotFoundError)
    ).rejects.toBe(err)
    expect(load).toHaveBeenCalledTimes(1)
  })
})
