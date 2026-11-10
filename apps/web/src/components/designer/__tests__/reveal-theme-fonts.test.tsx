// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'

const own = vi.hoisted(() => ({ requestOwnFont: vi.fn() }))
vi.mock('@/components/admin/settings/appearance/fonts-section', async (original) => ({
  ...(await original<typeof import('@/components/admin/settings/appearance/fonts-section')>()),
  requestOwnFont: own.requestOwnFont,
}))

vi.mock('@/lib/server/functions/uploads', () => ({
  getFontUploadUrlFn: vi.fn(),
  checkS3ConfiguredFn: async () => ({ configured: true }),
}))

const { BrandKitFonts, revealThemeFonts, THEME_FONTS_ID } = await import('../brand-kit-fonts')

afterEach(() => {
  cleanup()
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

describe('the Brand kit fonts after a match', () => {
  const fonts = (design: PortalDesign) =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <BrandKitFonts design={design} update={vi.fn()} />
      </QueryClientProvider>
    )

  it('offers the upload of the site’s face the match could not match', () => {
    const design = defaultDesign()
    design.brand.unmatchedFont = { family: 'Acme Grotesk', slot: 'heading' }
    fonts(design)
    fireEvent.click(screen.getByRole('button', { name: 'Upload Acme Grotesk' }))
    expect(own.requestOwnFont).toHaveBeenCalledWith({ family: 'Acme Grotesk', slot: 'heading' })
  })

  it('offers nothing once that face is uploaded, or when no match missed one', () => {
    fonts(defaultDesign())
    expect(screen.queryByRole('button', { name: /^Upload / })).toBeNull()
    cleanup()
    const design = defaultDesign()
    design.brand.unmatchedFont = { family: 'Acme Grotesk', slot: 'heading' }
    design.brand.fonts.heading = {
      kind: 'uploaded',
      family: 'Acme Grotesk',
      files: [{ key: 'fonts/acme.woff2', weight: 400, style: 'normal' }],
      fallback: 'inter',
    }
    fonts(design)
    expect(screen.queryByRole('button', { name: 'Upload Acme Grotesk' })).toBeNull()
  })
})
