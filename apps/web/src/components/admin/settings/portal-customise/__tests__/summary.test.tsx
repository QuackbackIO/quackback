// @vitest-environment happy-dom
/**
 * Settings > Portal is a quiet summary of what is live, with one Customise
 * button: the logo, light and dark, the colours, font, corners, tabs, the
 * welcome message and Advanced CSS, each label left, value right.
 */
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { portalSummary } from '../summary'
import { PortalSummaryCard } from '../summary-card'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
  ClientOnly: () => null,
}))

afterEach(cleanup)

const welcome = {
  body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }] },
}

const live = {
  theme: {
    themeMode: 'user' as const,
    buttonShape: 'corners' as const,
    light: {
      primary: '#1a73e8',
      background: '#f8f6f1',
      radius: '0rem',
      fontSans: '"Lora", ui-serif, Georgia, serif',
    },
  },
  customCss: '',
  portal: {
    nav: {
      items: [
        { id: 'feedback', type: 'feedback' as const },
        { id: 'roadmap', type: 'roadmap' as const },
      ],
    },
    welcomeCard: welcome,
  },
  logoUrl: null,
  headerLogo: null,
  gatedTypes: new Set<string>(),
}

const rows = (summary: ReturnType<typeof portalSummary>) =>
  Object.fromEntries(summary.map((row) => [row.label, row.value]))

describe('portalSummary', () => {
  it('reads every row from what is live', () => {
    expect(rows(portalSummary(live))).toEqual({
      Header: 'Name',
      'Light and dark': 'Visitor chooses',
      'Main colour': '#1a73e8',
      Background: '#f8f6f1',
      Font: 'Lora',
      Corners: 'Sharp, matching buttons',
      Navigation: '6 tabs',
      'Welcome message': 'Shown',
      'Advanced CSS': 'Theme only',
    })
  })

  it('says Auto for an untouched background and pill buttons by default', () => {
    const summary = rows(
      portalSummary({ ...live, theme: { themeMode: 'light' }, portal: {}, logoUrl: '/logo.png' })
    )
    expect(summary.Header).toBe('Icon and name')
    expect(summary['Light and dark']).toBe('Light')
    expect(summary.Background).toBe('Auto')
    expect(summary.Corners).toBe('Soft, pill buttons')
    expect(summary['Welcome message']).toBe('Off')
  })

  it('names the logo and own CSS rules', () => {
    const summary = rows(
      portalSummary({
        ...live,
        headerLogo: { url: '/wide.svg', displayMode: 'custom_logo' },
        customCss: '.portal-header { background: linear-gradient(red, blue); }',
      })
    )
    expect(summary.Header).toBe('Logo')
    expect(summary['Advanced CSS']).toBe('Own rules')
  })

  it('names an uploaded font by its family, and the logo only while the header shows it', () => {
    const customFont = {
      family: 'Brand Sans',
      fallback: 'lora' as const,
      files: [{ key: 'fonts/2026/11/a-brand.woff2', weight: 400, style: 'normal' as const }],
    }
    const summary = rows(
      portalSummary({
        ...live,
        theme: { ...live.theme, customFont },
        logoUrl: '/logo.png',
        headerLogo: { url: '/wide.svg', displayMode: 'logo_and_name' },
      })
    )
    expect(summary.Font).toBe('Brand Sans')
    expect(summary.Header).toBe('Icon and name')
    // A stored family the theme would not write is not what visitors see.
    const unsafe = rows(
      portalSummary({
        ...live,
        theme: { ...live.theme, customFont: { ...customFont, family: 'A"}' } },
      })
    )
    expect(unsafe.Font).toBe('Lora')
  })

  it('counts only the tabs visitors see', () => {
    const summary = rows(
      portalSummary({ ...live, gatedTypes: new Set(['changelog', 'help', 'support', 'status']) })
    )
    expect(summary.Navigation).toBe('2 tabs')
  })
})

describe('PortalSummaryCard', () => {
  it('leads to Customise and lists the values', () => {
    render(<PortalSummaryCard summary={portalSummary(live)} />)
    expect(screen.getByRole('link', { name: 'Customise' })).toHaveAttribute(
      'href',
      '/admin/settings/portal/customise'
    )
    expect(screen.getByText('Look and navigation')).toBeInTheDocument()
    expect(screen.getByText('Sharp, matching buttons')).toBeInTheDocument()
  })
})
