// @vitest-environment happy-dom
/**
 * The hero and the active-incident card print small labels on a solid status
 * color. Those labels were translucent white (`text-white/80`, `/85`), which
 * fell below WCAG AA; they now use the banner's own text color at full
 * strength (the pairings themselves are checked in status-colors.test.ts).
 */
import { afterEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import type { StatusIncidentId } from '@quackback/ids'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className }: { children: ReactNode; className?: string }) => (
    <a className={className}>{children}</a>
  ),
}))

const { StatusHero } = await import('../status-hero')
const { StatusIncidentCard } = await import('../status-incident-card')

afterEach(cleanup)

function translucentText(container: HTMLElement): Element[] {
  return [...container.querySelectorAll('*')].filter((el) =>
    [...el.classList].some((c) => /^text-white\/\d+$/.test(c))
  )
}

it('the hero carries its status text color and no translucent labels', () => {
  const { container } = render(
    <IntlProvider locale="en" defaultLocale="en">
      <StatusHero status="degraded_performance" lastUpdatedAt={new Date().toISOString()} />
    </IntlProvider>
  )
  const banner = screen.getByRole('heading', { name: 'Partially degraded service' }).closest('div')
    ?.parentElement as HTMLElement
  expect(banner).toHaveClass('bg-amber-400', 'text-amber-950')
  expect(translucentText(container)).toEqual([])
})

it('the incident card header carries its impact text color and no translucent labels', () => {
  const { container } = render(
    <IntlProvider locale="en" defaultLocale="en">
      <StatusIncidentCard
        incident={{
          id: 'status_incident_1' as StatusIncidentId,
          title: 'API errors',
          status: 'investigating',
          impact: 'major',
          affectedComponents: [],
          updates: [],
        }}
      />
    </IntlProvider>
  )
  const header = screen.getByRole('heading', { name: 'API errors' }).parentElement as HTMLElement
  expect(header).toHaveClass('bg-orange-700', 'text-white')
  expect(translucentText(container)).toEqual([])
})
