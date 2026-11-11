// @vitest-environment happy-dom
/**
 * Toasts draw in the page's theme: a forced one (a portal design's mode)
 * over the visitor's own, which the provider then holds as the device's.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const themes = vi.hoisted(() => ({ theme: 'system', forcedTheme: undefined as string | undefined }))
const drawn = vi.hoisted(() => ({ theme: '' as string | undefined }))
vi.mock('next-themes', () => ({ useTheme: () => themes }))
vi.mock('sonner', () => ({
  Toaster: ({ theme }: { theme?: string }) => {
    drawn.theme = theme
    return null
  },
}))

import { Toaster } from '../sonner'

afterEach(() => {
  cleanup()
  themes.forcedTheme = undefined
})

it('draws toasts in a forced theme over the visitor’s own', () => {
  themes.forcedTheme = 'dark'
  render(<Toaster locale="en" />)
  expect(drawn.theme).toBe('dark')
})

it('follows the visitor’s theme where none is forced', () => {
  render(<Toaster locale="en" />)
  expect(drawn.theme).toBe('system')
})
