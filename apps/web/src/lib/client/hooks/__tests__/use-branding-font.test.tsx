// @vitest-environment happy-dom
/**
 * A legacy portal loads the one family its CSS names; a design loads its body
 * and heading families as well, each once.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'

const loaded = vi.hoisted(() => ({ ids: [] as string[] }))
vi.mock('@/lib/shared/theme', async (original) => ({
  ...(await original<typeof import('@/lib/shared/theme')>()),
  loadBrandingFont: (id: string) => {
    loaded.ids.push(id)
    return Promise.resolve()
  },
}))

const { useBrandingFont } = await import('../use-branding-font')

afterEach(() => {
  cleanup()
  loaded.ids = []
})

describe('useBrandingFont', () => {
  it('loads the family a legacy theme names', () => {
    renderHook(() => useBrandingFont('', '"Manrope", ui-sans-serif, system-ui, sans-serif'))
    expect(loaded.ids).toEqual(['manrope'])
  })

  it('loads a design’s body and heading families once each', () => {
    renderHook(() =>
      useBrandingFont('', '"Fraunces", ui-serif, Georgia, serif', ['inter', 'fraunces', 'fraunces'])
    )
    expect(loaded.ids).toEqual(['inter', 'fraunces'])
  })
})
