// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'react-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '@/locales/en.json'
import type { FirstWinSummary } from '@/lib/server/domains/onboarding/first-win-summary'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

import { HomeFirstWin, HomePlanDone } from '../home-first-win'

afterEach(cleanup)

const idea: FirstWinSummary = {
  kind: 'idea',
  name: 'Ana Silva',
  domain: 'northwind.example',
  subject: 'Export ideas to CSV',
  votes: 1,
  avatarUrl: null,
  at: '2026-10-01T10:00:00.000Z',
  href: '/admin/feedback?post=post_1',
}

function show(summary: FirstWinSummary | null) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <HomeFirstWin summary={summary} pending={false} onDismiss={() => {}} />
    </IntlProvider>
  )
}

describe('the first win', () => {
  it('leads with the outcome, then who it was and their idea in their words', () => {
    show(idea)
    const card = screen.getByRole('region', { name: 'Your first customer idea is in' })
    const heading = within(card).getByRole('heading', { name: 'Your first customer idea is in' })
    // Focus can land on it when the win arrives while someone is on Home.
    expect(heading).toHaveAttribute('tabindex', '-1')
    expect(card).toHaveTextContent('Ana Silva from northwind.example · 1 vote')
    expect(within(card).getByText('AS')).toBeTruthy()
    expect(card.querySelector('blockquote')?.textContent).toBe('Export ideas to CSV')
  })

  it('has View idea as its one filled button, and a quiet Dismiss', () => {
    show(idea)
    const card = screen.getByRole('region', { name: 'Your first customer idea is in' })
    const view = within(card).getByRole('link', { name: 'View idea' })
    expect(view).toHaveAttribute('href', '/admin/feedback?post=post_1')
    expect(view.className).toContain('bg-primary')
    const dismiss = within(card).getByRole('button', { name: 'Dismiss' })
    expect(dismiss.className).not.toContain('bg-primary')
  })

  it('names an anonymous visitor plainly, so a generated name never reads as a person', () => {
    show({ ...idea, name: 'Wild Otter', domain: null, visitor: true, votes: 0 })
    const card = screen.getByRole('region', { name: 'Your first customer idea is in' })
    expect(card).toHaveTextContent('Wild Otter (an anonymous visitor)')
    // No initials, which would make the handle look like someone's name.
    expect(within(card).queryByText('WO')).toBeNull()

    cleanup()
    show({ ...idea, name: null, domain: null, visitor: true, votes: 0 })
    expect(screen.getByRole('region')).toHaveTextContent('An anonymous visitor')
  })

  it('says what the goal reached, for each kind of first win', () => {
    const titles: Array<[FirstWinSummary['kind'], string]> = [
      ['vote', 'Your first customer vote is in'],
      ['teamIdea', 'Your team’s first idea is in'],
      ['conversation', 'Your first conversation'],
      ['helpful', 'A customer found your article helpful'],
      ['subscriber', 'Your first subscriber'],
    ]
    for (const [kind, title] of titles) {
      show({ ...idea, kind })
      expect(screen.getByRole('heading', { name: title })).toBeTruthy()
      cleanup()
    }
  })

  it('links a help center win to the article that helped', () => {
    show({
      kind: 'helpful',
      name: null,
      domain: null,
      visitor: true,
      subject: 'How do I reset my password?',
      avatarUrl: null,
      at: '2026-10-01T10:00:00.000Z',
      href: '/admin/help-center?article=article_1',
    })
    expect(screen.getByRole('region')).toHaveTextContent('How do I reset my password?')
    expect(screen.getByRole('link', { name: 'See article' })).toHaveAttribute(
      'href',
      '/admin/help-center?article=article_1'
    )
  })
})

describe('the finished plan', () => {
  it('stays as one quiet row that leads to the optional steps', () => {
    render(
      <IntlProvider locale="en" messages={en}>
        <HomePlanDone optional={3} />
      </IntlProvider>
    )
    const row = screen.getByRole('region', { name: 'Launch plan done.' })
    expect(row).toHaveTextContent('Launch plan done. 3 optional steps')
    expect(within(row).getByRole('link', { name: '3 optional steps' })).toHaveAttribute(
      'href',
      '/admin/getting-started'
    )
    expect(within(row).getByRole('heading')).toHaveAttribute('tabindex', '-1')
  })
})
