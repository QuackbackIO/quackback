// @vitest-environment happy-dom
/**
 * Site images say what visitors really get: the favicon falls back to the
 * brand icon, then the workspace logo, and the link preview shows the card
 * the portal draws from the brand, in the brand's colours, with words that
 * speak of posts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'

vi.mock('@/lib/server/functions/uploads', () => ({
  getFaviconUploadUrlFn: vi.fn(),
  getShareImageUploadUrlFn: vi.fn(),
  getWordmarkUploadUrlFn: vi.fn(),
}))
vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useWorkspaceSettings: () => ({ name: 'Acme Corp' }),
  useBaseUrl: () => 'https://feedback.acme.test',
}))

const { BrandKitImages } = await import('../brand-kit')

function renderImages(design: PortalDesign, logoUrl: string | null = '/workspace-logo.png') {
  return render(<BrandKitImages design={design} update={() => {}} logoUrl={logoUrl} />)
}

afterEach(cleanup)

describe('the favicon', () => {
  it('falls back to the brand icon before the workspace logo', () => {
    const design = defaultDesign()
    design.brand.logo.mark.light = { key: 'logos/icon.png' }
    renderImages(design)
    expect(screen.getByText('From icon')).toBeTruthy()
    expect(screen.queryByText('Workspace logo')).toBeNull()
  })

  it('falls back to the workspace logo when there is no icon', () => {
    renderImages(defaultDesign())
    expect(screen.getByText('Workspace logo')).toBeTruthy()
  })
})

describe('the link preview', () => {
  it('shows the drawn card in the page colour with the title, the address and posts', () => {
    const design = defaultDesign()
    design.brand.light.background = '#0c862c'
    design.brand.logo.name = 'GitHub'
    renderImages(design)
    const preview = within(screen.getByRole('figure', { name: 'Link preview' }))
    const card = screen.getByTestId('link-preview-card')
    expect(card.style.background).toMatch(/#0c862c|rgb\(12, 134, 44\)/)
    expect(preview.getAllByText('GitHub').length).toBeGreaterThan(0)
    expect(preview.getByText('feedback.acme.test')).toBeTruthy()
    expect(preview.getByText(/vote on posts/)).toBeTruthy()
  })

  it('shows the design’s own share image in place of the card', () => {
    const design = defaultDesign()
    design.brand.shareImage = { key: 'portal-images/s.png' }
    renderImages(design)
    expect(screen.queryByTestId('link-preview-card')).toBeNull()
    const figure = screen.getByRole('figure', { name: 'Link preview' })
    expect(figure.querySelector('img')?.getAttribute('src')).toBe(
      '/api/storage/portal-images/s.png'
    )
  })
})
