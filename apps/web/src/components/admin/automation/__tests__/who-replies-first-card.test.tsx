// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { WHO_REPLIES_FIRST } from '@/lib/shared/assistant/who-replies-first'

const hoisted = vi.hoisted(() => ({
  pathname: '/admin/automation/workflows',
  permissions: new Set<string>(['assistant.manage', 'office_hours.manage', 'workflow.manage']),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useRouteContext: () => ({ settings: { featureFlags: { supportInbox: true } } }),
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => string }) =>
    select({ location: { pathname: hoisted.pathname } }),
}))

vi.mock('@/lib/client/hooks/use-permission', () => ({
  usePermission: (key: string) => hoisted.permissions.has(key),
}))

import { WhoRepliesFirstCard } from '../who-replies-first-card'

afterEach(() => {
  cleanup()
  hoisted.pathname = '/admin/automation/workflows'
  hoisted.permissions = new Set(['assistant.manage', 'office_hours.manage', 'workflow.manage'])
})

function renderCard() {
  return render(
    <IntlProvider locale="en" defaultLocale="en" messages={{}}>
      <WhoRepliesFirstCard />
    </IntlProvider>
  )
}

describe('WHO_REPLIES_FIRST', () => {
  it('holds a title and three steps', () => {
    expect(WHO_REPLIES_FIRST.title).toBe('Who replies first')
    expect(WHO_REPLIES_FIRST.steps).toHaveLength(3)
    expect(WHO_REPLIES_FIRST.steps[0]!.defaultMessage).toContain('Quinn answers instantly')
    expect(WHO_REPLIES_FIRST.steps[1]!.defaultMessage).toContain('{order}')
    expect(WHO_REPLIES_FIRST.orderBelow).toBe('in the order below')
    expect(WHO_REPLIES_FIRST.orderOnWorkflows).toBe('in the order on Workflows')
    expect(WHO_REPLIES_FIRST.steps[2]!.defaultMessage).toContain(
      'the workflow decides the assignment'
    )
  })
})

describe('WhoRepliesFirstCard', () => {
  it('renders the three-step list and permission-aware links', () => {
    renderCard()
    expect(screen.getByText('Who replies first')).toBeTruthy()
    expect(screen.getByText(/Quinn answers instantly/)).toBeTruthy()
    expect(screen.getByText(/Customer-facing workflows/)).toBeTruthy()
    expect(screen.getByText(/in the order below/)).toBeTruthy()
    expect(screen.getByText(/the workflow decides the assignment/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Manage Quinn' })).toHaveAttribute(
      'href',
      '/admin/automation/agent'
    )
    expect(screen.queryByRole('link', { name: 'Manage workflows' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Office hours' })).toHaveAttribute(
      'href',
      '/admin/settings/office-hours'
    )
  })

  it('hides Manage Quinn on the agent page and points at Workflows', () => {
    hoisted.pathname = '/admin/automation/agent'
    renderCard()
    expect(screen.queryByRole('link', { name: 'Manage Quinn' })).toBeNull()
    expect(screen.getByText(/in the order on Workflows/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Manage workflows' })).toHaveAttribute(
      'href',
      '/admin/automation/workflows'
    )
    expect(screen.getByRole('link', { name: 'Office hours' })).toBeTruthy()
  })

  it('hides Office hours when the admin cannot open that settings page', () => {
    hoisted.permissions = new Set(['assistant.manage'])
    renderCard()
    expect(screen.getByRole('link', { name: 'Manage Quinn' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Office hours' })).toBeNull()
  })
})
