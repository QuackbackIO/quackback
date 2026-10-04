// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/locales/en.json'
import de from '@/locales/de.json'
import type { LaunchStatus } from '@/lib/shared/launch-checklist'

const hoisted = vi.hoisted(() => ({ canConverse: true, opened: [] as unknown[] }))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))
vi.mock('@/lib/client/hooks/use-permission', () => ({
  usePermission: (key: string) => key === 'conversation.view' && hoisted.canConverse,
}))
vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useWorkspaceSettings: () => ({
    name: 'Acme',
    brandingData: { name: 'Acme', logoUrl: null, faviconUrl: null, headerLogoUrl: null },
  }),
}))
vi.mock('@/lib/server/functions/activation', () => ({ markPublicBoardLinkCopiedFn: vi.fn() }))
vi.mock('@/lib/client/plg-events', () => ({ recordPlgEvent: vi.fn() }))

import { HomeNextStep } from '../home-next-step'

const status: LaunchStatus = {
  hasBoards: true,
  hasPublicBoard: true,
  publicBoardId: 'board_1',
  publicBoardPath: '/?board=feedback',
  memberCount: 1,
  hasBranding: false,
  canPostTestIdea: true,
  goals: ['product_feedback', 'customer_support'],
  features: {
    supportInbox: true,
    helpCenter: false,
    statusPage: false,
    integrations: true,
    assistant: false,
    changelog: true,
  },
} as LaunchStatus

function mount(input: LaunchStatus = status, notice?: ReactNode) {
  const client = new QueryClient()
  client.setQueryData(['admin', 'onboarding'], input)
  return render(
    <IntlProvider locale="en" messages={en}>
      <QueryClientProvider client={client}>
        <HomeNextStep
          status={input}
          portalUrl="https://acme.example.com"
          brandingNotice={notice}
          pending={false}
          onCreateBoard={() => {}}
        />
      </QueryClientProvider>
    </IntlProvider>
  )
}

beforeEach(() => {
  hoisted.canConverse = true
  hoisted.opened = []
  window.addEventListener('quackback:open-try-messenger', (event) =>
    hoisted.opened.push((event as CustomEvent).detail)
  )
})
afterEach(cleanup)

describe("Home's next step", () => {
  it('leads with one step: its outcome, one primary action and a test', () => {
    mount()
    const card = screen.getByRole('region', { name: 'Share your board' })
    expect(card).toHaveTextContent('Next step · 2 of 3')
    expect(card).toHaveTextContent('Customers find your board')
    expect(within(card).getByRole('button', { name: 'Copy board link' })).toBeVisible()
    fireEvent.click(within(card).getByRole('button', { name: 'Post a test idea' }))
    expect(hoisted.opened).toContain('idea')
    expect(within(card).getByRole('link', { name: 'acme.example.com' })).toHaveAttribute(
      'href',
      'https://acme.example.com'
    )
  })

  it('shows the path to a first idea and what comes later', () => {
    mount()
    const path = screen.getByRole('region', { name: 'Your path to a first idea' })
    const rows = within(path)
      .getAllByRole('listitem')
      .map((row) => row.textContent)
    expect(rows).toEqual(['Portal is liveDone', 'Share your boardNext', 'Get your first idea'])
    expect(path).toHaveTextContent(
      'Later: Publish your first update, invite a teammate, and add your logo'
    )
  })

  it('makes the test the action once only the first result is left', () => {
    mount({ ...status, publicBoardLinkCopiedAt: '2026-10-04T10:00:00.000Z' })
    const card = screen.getByRole('region', { name: 'Get your first idea' })
    expect(card).toHaveTextContent('Next step · 3 of 3')
    expect(
      within(card)
        .getAllByRole('button')
        .map((button) => button.textContent)
    ).toEqual(['Post a test idea'])
  })

  it('offers no test the person cannot run', () => {
    hoisted.canConverse = false
    mount()
    expect(screen.queryByRole('button', { name: 'Post a test idea' })).toBeNull()
  })

  it('keeps the automatic logo notice beside the portal snapshot', () => {
    mount(status, <button type="button">Undo</button>)
    const card = screen.getByRole('region', { name: 'Share your board' })
    expect(within(card).getByRole('button', { name: 'Undo' })).toBeVisible()
  })

  it('joins the Later line the way each language does', () => {
    cleanup()
    const client = new QueryClient()
    client.setQueryData(['admin', 'onboarding'], status)
    render(
      <IntlProvider locale="de" messages={de}>
        <QueryClientProvider client={client}>
          <HomeNextStep status={status} pending={false} onCreateBoard={() => {}} />
        </QueryClientProvider>
      </IntlProvider>
    )
    // German keeps its capitals and joins with "und".
    expect(screen.getByText(/^Später:/).textContent).toMatch(
      /, Teammitglied einladen und Logo hinzufügen$/
    )
  })
})
