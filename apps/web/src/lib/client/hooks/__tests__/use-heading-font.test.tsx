// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const loadHeadingFont = vi.hoisted(() => vi.fn(async (_id: string) => undefined))
vi.mock('@/lib/shared/theme/heading-font-loader', () => ({ loadHeadingFont }))

import { useHeadingFont } from '../use-heading-font'

const INTER = '"Inter Variable", "Inter", ui-sans-serif, system-ui, sans-serif'
const LORA = '"Lora", ui-serif, Georgia, serif'

describe('useHeadingFont', () => {
  beforeEach(() => loadHeadingFont.mockClear())

  it('loads the headings font when the theme sets one that is not the text font', async () => {
    renderHook(() => useHeadingFont('', INTER, LORA))
    await vi.waitFor(() => expect(loadHeadingFont).toHaveBeenCalledWith('lora'))
    expect(loadHeadingFont).toHaveBeenCalledOnce()
  })

  it('loads nothing when headings are set in the text font, or in none of their own', async () => {
    renderHook(() => useHeadingFont('', LORA, LORA))
    renderHook(() => useHeadingFont('', INTER, null))
    // The loader arrives by a dynamic import: give one the time to land.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(loadHeadingFont).not.toHaveBeenCalled()
  })
})
