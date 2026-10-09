// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/locales/en.json'
import de from '@/locales/de.json'
import { launchPath, type LaunchStatus } from '@/lib/shared/launch-checklist'

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
vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useBaseUrl: () => 'https://acme.example.com',
  useWorkspaceSettings: () => ({
    name: 'Acme',
    brandingData: { name: 'Acme', logoUrl: null, faviconUrl: null, headerLogoUrl: null },
  }),
}))
vi.mock('@/lib/server/functions/activation', () => ({
  markPublicBoardLinkCopiedFn: vi.fn(),
  markStatusLinkCopiedFn: vi.fn(),
}))
vi.mock('@/lib/client/plg-events', () => ({ recordPlgEvent: vi.fn() }))

import { HomeNextStep } from '../home-next-step'

const status: LaunchStatus = {
  hasBoards: true,
  hasPublicBoard: true,
  publicBoardId: 'board_1',
  publicBoardPath: '/?board=feedback',
  memberCount: 1,
  hasBranding: false,
  goals: ['product_feedback', 'customer_support'],
  features: {
    supportInbox: true,
    helpCenter: false,
    statusPage: false,
    integrations: true,
    assistant: false,
    changelog: true,
  },
}

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

const writeText = vi.fn()
beforeEach(() => {
  writeText.mockReset()
  writeText.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})
afterEach(cleanup)

/** The open step's own actions: the card's one action lives there. */
function actions(card: HTMLElement) {
  const step = card.querySelector<HTMLElement>('[data-state="current"]')!
  return within(step)
    .getAllByRole('button')
    .map((button) => button.textContent)
}

/** The path's rows as Home shows them: the step and its state. */
function rows(card: HTMLElement) {
  return within(card)
    .getAllByRole('listitem')
    .map((row) => ({
      step: row.querySelector('[data-slot="path-step"]')?.textContent,
      state: row.getAttribute('data-state'),
    }))
}

describe("Home's launch plan card", () => {
  it('is one card: the path, with the current step open and its one action', () => {
    mount()
    const card = screen.getByRole('region', { name: 'Share your board link' })
    expect(card).toHaveTextContent('Launch plan · Step 2 of 3')
    expect(rows(card)).toEqual([
      { step: 'Your board is live', state: 'done' },
      { step: 'Share your board link', state: 'current' },
      { step: 'A customer posts an idea', state: 'waiting' },
    ])
    expect(card).toHaveTextContent('Paste it wherever they already talk to you.')
    expect(actions(card)).toEqual(['Copy board link'])
    expect(within(card).getByRole('link', { name: /View board/ })).toHaveAttribute(
      'href',
      'https://acme.example.com/?board=feedback'
    )
    // The current step is the heading focus can move to.
    expect(screen.getByRole('heading', { name: 'Share your board link' })).toHaveAttribute(
      'tabindex',
      '-1'
    )
  })

  it('says each thing once: the step, the plan name and the address', () => {
    mount()
    expect(screen.getAllByText('Share your board link')).toHaveLength(1)
    expect(screen.getAllByText(/Launch plan/)).toHaveLength(1)
    expect(screen.getAllByText(/acme\.example\.com/)).toHaveLength(1)
  })

  it('names every picked goal’s open step under Later, then the polish, as the plan page does', () => {
    const goals: LaunchStatus = {
      ...status,
      goals: ['product_feedback', 'customer_support', 'help_center'],
      features: { ...status.features!, helpCenter: true },
    }
    mount(goals)
    // Support and Help center come before the polish, as on the plan page.
    const open = launchPath(goals).later.filter((task) => !task.isCompleted && !task.isSkipped)
    expect(open.map((task) => task.title)).toEqual([
      'Put Messenger on your site',
      'Publish your first article',
      'Publish your first update',
      'Invite your team',
      'Add your logo',
      'Connect an integration',
    ])
    const later = screen.getByText(/^Later:/)
    expect(later.textContent).toBe(
      'Later: Put Messenger on your site, publish your first article, publish your first update, and 3 more'
    )
    expect(within(later).getByRole('link', { name: 'Put Messenger on your site' })).toHaveAttribute(
      'href',
      '/admin/settings/widget/install'
    )
    expect(screen.getByRole('link', { name: 'All steps' })).toHaveAttribute(
      'href',
      '/admin/getting-started'
    )
  })

  it('leaves done and skipped steps out of Later', () => {
    mount({
      ...status,
      hasWidgetInstalled: true,
      hasWidgetEnabled: true,
      hasPublishedChangelog: true,
      taskResolutions: {
        product_feedback: {
          'invite-team': { resolution: 'dismissed', resolvedAt: '2026-10-04T10:00:00.000Z' },
        },
      },
    })
    expect(screen.getByText(/^Later:/).textContent).toBe(
      'Later: Add your logo and connect an integration'
    )
  })

  it('offers sharing the board again once only the first win is left', () => {
    mount({ ...status, publicBoardLinkCopiedAt: '2026-10-04T10:00:00.000Z' })
    const card = screen.getByRole('region', { name: 'A customer posts an idea' })
    expect(card).toHaveTextContent('Launch plan · Step 3 of 3')
    expect(card).toHaveTextContent('Your own tests never count.')
    expect(rows(card).map((row) => row.state)).toEqual(['done', 'done', 'current'])
    expect(actions(card)).toEqual(['Copy board link'])
  })

  it('stays on Home when every chore is done but no customer has acted', () => {
    mount({
      ...status,
      publicBoardLinkCopiedAt: '2026-10-04T10:00:00.000Z',
      hasBranding: true,
      memberCount: 2,
      hasPublishedChangelog: true,
      hasWidgetInstalled: true,
      hasWidgetEnabled: true,
    })
    expect(screen.getByRole('region', { name: 'A customer posts an idea' })).toBeVisible()
  })

  it('gives the help center its link to copy, again and again, while it waits for a reader', async () => {
    mount({
      ...status,
      goals: ['help_center'],
      hasHelpArticle: true,
      features: { ...status.features!, helpCenter: true },
    })
    const card = screen.getByRole('region', { name: 'A customer finds it helpful' })
    const copy = within(card).getByRole('button', { name: 'Copy help center link' })
    fireEvent.click(copy)
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://acme.example.com/hc'))
    await waitFor(() => expect(copy).not.toBeDisabled())
    fireEvent.click(copy)
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2))
    expect(within(card).getByRole('button', { name: 'Copy help center link' })).toBe(copy)
  })

  it('leads a status page with sharing it: one action and the live page', () => {
    mount({
      ...status,
      goals: ['status_page'],
      hasStatusComponent: true,
      features: { ...status.features!, statusPage: true },
    })
    const card = screen.getByRole('region', { name: 'Share your status page' })
    expect(actions(card)).toEqual(['Copy status link'])
    expect(within(card).queryByRole('link', { name: 'Add a service' })).toBeNull()
    expect(within(card).getByRole('link', { name: /View status page/ })).toHaveAttribute(
      'href',
      'https://acme.example.com/status'
    )
  })

  it('keeps the status link to copy again while it waits for a subscriber', async () => {
    mount({
      ...status,
      goals: ['status_page'],
      hasStatusComponent: true,
      statusLinkCopiedAt: '2026-10-04T10:00:00.000Z',
      features: { ...status.features!, statusPage: true },
    })
    const card = screen.getByRole('region', { name: 'A customer subscribes' })
    fireEvent.click(within(card).getByRole('button', { name: 'Copy status link' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://acme.example.com/status'))
  })

  it('falls back to sharing the board when the primary module is turned off', () => {
    const modules = ['supportInbox', 'helpCenter', 'statusPage'] as const
    const goals = {
      supportInbox: 'customer_support',
      helpCenter: 'help_center',
      statusPage: 'status_page',
    } as const
    for (const module of modules) {
      mount({
        ...status,
        goals: [goals[module]],
        features: { ...status.features!, [module]: false },
      })
      const card = screen.getByRole('region', { name: 'Share your board link' })
      expect(card).toHaveTextContent('Launch plan · Step 2 of 3')
      cleanup()
    }
  })

  it('is drawn like the admin cards: one flat panel', () => {
    mount()
    const card = screen.getByRole('region', { name: 'Share your board link' })
    expect(card.className).toContain('rounded-panel')
    expect(card.className).toContain('p-5')
    expect(card.className).not.toMatch(/shadow-/)
  })

  it('keeps the automatic logo notice beside the portal snapshot', () => {
    mount(status, <button type="button">Undo</button>)
    const card = screen.getByRole('region', { name: 'Share your board link' })
    expect(within(card).getByRole('button', { name: 'Undo' })).toBeVisible()
  })

  it('joins the Later line the way each language does', () => {
    cleanup()
    const client = new QueryClient()
    const short: LaunchStatus = {
      ...status,
      goals: ['product_feedback'],
      features: { ...status.features!, supportInbox: false, integrations: false, changelog: false },
    }
    client.setQueryData(['admin', 'onboarding'], short)
    render(
      <IntlProvider locale="de" messages={de}>
        <QueryClientProvider client={client}>
          <HomeNextStep status={short} pending={false} onCreateBoard={() => {}} />
        </QueryClientProvider>
      </IntlProvider>
    )
    // German keeps its capitals and joins with "und".
    expect(screen.getByText(/^Später:/).textContent).toMatch(/ und Logo hinzufügen$/)
    // The region says which language it is in; the admin document stays English.
    expect(screen.getByText(/^Später:/).closest('[lang]')).toHaveAttribute('lang', 'de')
  })
})
