// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'react-intl'
import { afterEach, expect, it, vi } from 'vitest'
import en from '@/locales/en.json'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}))

import { HomeFirstWin } from '../home-first-win'

afterEach(cleanup)

it('names a signed-out reader as a visitor, with the article and a link to it', () => {
  render(
    <IntlProvider locale="en" messages={en}>
      <HomeFirstWin
        summary={{
          kind: 'helpful',
          name: null,
          domain: null,
          visitor: true,
          subject: 'How do I reset my password?',
          at: '2026-10-01T10:00:00.000Z',
          href: '/admin/help-center?article=article_1',
        }}
        next={null}
        pending={false}
        onDismiss={() => {}}
      />
    </IntlProvider>
  )
  expect(screen.getByText('A visitor found an article helpful')).toBeTruthy()
  expect(screen.getByText('How do I reset my password?')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'See article' }).getAttribute('href')).toBe(
    '/admin/help-center?article=article_1'
  )
})

it('says a customer voted, naming the idea they voted for', () => {
  render(
    <IntlProvider locale="en" messages={en}>
      <HomeFirstWin
        summary={{
          kind: 'vote',
          name: 'Ana Silva',
          domain: 'northwind.example',
          subject: 'Dark mode',
          votes: 1,
          at: '2026-10-01T10:00:00.000Z',
          href: '/admin/feedback?post=post_1',
        }}
        next={null}
        pending={false}
        onDismiss={() => {}}
      />
    </IntlProvider>
  )
  expect(screen.getByText('Ana Silva from northwind.example voted for an idea')).toBeTruthy()
  expect(screen.getByText('Dark mode · 1 vote')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'View idea' }).getAttribute('href')).toBe(
    '/admin/feedback?post=post_1'
  )
})
