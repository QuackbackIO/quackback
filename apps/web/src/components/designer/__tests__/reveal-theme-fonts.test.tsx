// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

const own = vi.hoisted(() => ({ requestOwnFont: vi.fn() }))
vi.mock('@/components/admin/settings/appearance/fonts-section', async (original) => ({
  ...(await original<typeof import('@/components/admin/settings/appearance/fonts-section')>()),
  requestOwnFont: own.requestOwnFont,
}))

const { revealThemeFonts, THEME_FONTS_ID } = await import('../brand-kit-fonts')

afterEach(() => {
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

const frames = () => new Promise((resolve) => setTimeout(resolve, 50))

describe('revealThemeFonts', () => {
  it('brings the Brand kit fonts into view once Theme draws them', async () => {
    revealThemeFonts()
    const fonts = document.createElement('div')
    fonts.id = THEME_FONTS_ID
    fonts.scrollIntoView = vi.fn()
    document.body.append(fonts)
    await frames()
    expect(fonts.scrollIntoView).toHaveBeenCalled()
    expect(own.requestOwnFont).not.toHaveBeenCalled()
  })

  it('opens the upload for the font named, for its slot', () => {
    revealThemeFonts({ family: 'Acme Grotesk', slot: 'both' })
    expect(own.requestOwnFont).toHaveBeenCalledWith({ family: 'Acme Grotesk', slot: 'both' })
  })
})
