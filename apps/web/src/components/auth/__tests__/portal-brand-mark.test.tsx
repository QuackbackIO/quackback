// @vitest-environment happy-dom
/**
 * The brand mark above the portal's sign-in pages follows the portal header:
 * the wide logo alone when the header shows it, else the square logo and name.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

const routeContext = vi.hoisted(() => ({ branding: null as Record<string, unknown> | null }))

vi.mock('@tanstack/react-router', () => ({
  useRouteContext: (opts: { select: (context: unknown) => unknown }) =>
    opts.select({ settings: { brandingData: routeContext.branding } }),
  Link: ({ children, className }: { children: ReactNode; className?: string }) => (
    <a href="/" className={className}>
      {children}
    </a>
  ),
}))

const { PortalBrandMark } = await import('../portal-brand-mark')

const WIDE = '/api/storage/header-logos/2026/11/abc-wordmark.svg'
const SQUARE = '/api/storage/logos/2026/11/abc-mark.png'

const branding = (headerDisplayMode: string, headerLogoUrl: string | null = WIDE) => ({
  name: 'Acme',
  logoUrl: SQUARE,
  faviconUrl: null,
  headerLogoUrl,
  ogImageUrl: null,
  headerDisplayMode,
  headerDisplayName: null,
})

afterEach(() => cleanup())

describe('PortalBrandMark', () => {
  it.each(['stack', 'row'] as const)(
    'shows the wide logo alone, uncropped, when the header does (%s)',
    (variant) => {
      routeContext.branding = branding('custom_logo')
      render(<PortalBrandMark variant={variant} />)
      const logo = screen.getByRole('img', { name: 'Acme' })
      expect(logo).toHaveAttribute('src', WIDE)
      expect(logo.className).toMatch(/\bobject-contain\b/)
      expect(logo.className).toMatch(/\bw-auto\b/)
      expect(logo.className).not.toMatch(/radius|rounded/)
      expect(screen.queryByText('Acme')).not.toBeInTheDocument()
    }
  )

  it('shows the logo’s dark mode version where the page is dark, beside the logo it replaces there', () => {
    const DARK = '/api/storage/header-logos/2026/11/abc-wordmark-dark.svg'
    routeContext.branding = { ...branding('custom_logo'), headerLogoDarkUrl: DARK }
    render(<PortalBrandMark />)
    const [light, dark] = screen.getAllByRole('img', { name: 'Acme' })
    expect(light).toHaveAttribute('src', WIDE)
    expect(light!.className).toMatch(/dark:hidden/)
    expect(dark).toHaveAttribute('src', DARK)
    expect(dark!.className).toMatch(/\bhidden\b.*dark:block|dark:block.*\bhidden\b/)
    cleanup()
    // Never with the square logo: the dark version is the wide logo's.
    routeContext.branding = { ...branding('logo_and_name'), headerLogoDarkUrl: DARK }
    render(<PortalBrandMark />)
    expect(screen.getAllByRole('img', { name: 'Acme' })).toHaveLength(1)
  })

  it('shows the square logo and the name otherwise, never the wide logo cropped square', () => {
    routeContext.branding = branding('logo_and_name')
    render(<PortalBrandMark />)
    expect(screen.getByRole('img', { name: 'Acme' })).toHaveAttribute('src', SQUARE)
    expect(screen.getByText('Acme')).toBeInTheDocument()
  })

  it('falls back to the square logo when the wide one is missing', () => {
    routeContext.branding = branding('custom_logo', null)
    render(<PortalBrandMark />)
    expect(screen.getByRole('img', { name: 'Acme' })).toHaveAttribute('src', SQUARE)
    expect(screen.getByText('Acme')).toBeInTheDocument()
  })
})
