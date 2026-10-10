// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const loadMessages = vi.fn(async (locale: string) => ({ greeting: `hello in ${locale}` }))

vi.mock('@/lib/shared/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shared/i18n')>()),
  loadMessages: (locale: string) => loadMessages(locale),
}))

const { useIntlSetup } = await import('../use-intl-setup')

describe('useIntlSetup', () => {
  beforeEach(() => loadMessages.mockClear())

  it('loads nothing for English, which renders from the code', async () => {
    const { result } = renderHook(() => useIntlSetup('en', {}))
    await act(async () => {})
    expect(result.current).toEqual({})
    expect(loadMessages).not.toHaveBeenCalled()
  })

  it('loads the catalog for another language the page did not seed', async () => {
    const { result } = renderHook(() => useIntlSetup('de'))
    await waitFor(() => expect(result.current).toEqual({ greeting: 'hello in de' }))
    expect(loadMessages).toHaveBeenCalledWith('de')
  })

  it('keeps a seeded catalog without loading it again', async () => {
    const seeded = { greeting: 'hallo' }
    const { result } = renderHook(() => useIntlSetup('de', seeded))
    await act(async () => {})
    expect(result.current).toBe(seeded)
    expect(loadMessages).not.toHaveBeenCalled()
  })

  it('drops the catalog without loading anything when the locale turns English', async () => {
    const { result, rerender } = renderHook(
      ({ locale }) => useIntlSetup(locale, { greeting: 'hallo' }),
      {
        initialProps: { locale: 'de' as 'de' | 'en' },
      }
    )
    rerender({ locale: 'en' })
    await waitFor(() => expect(result.current).toEqual({}))
    expect(loadMessages).not.toHaveBeenCalled()
  })
})
