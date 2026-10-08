// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}))

const article = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: article.toast, error: vi.fn() } }))
vi.mock('@/components/admin/help-center/create-article-dialog', () => ({
  CreateArticleDialog: ({ onPublished }: { onPublished?: (id: string) => void }) => (
    <button type="button" onClick={() => onPublished?.('kb_article_1')}>
      Publish
    </button>
  ),
}))

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LaunchStepAction } from '../launch-step-action'
import { OPEN_GOING_LIVE_EVENT } from '../going-live-events'
import type { LaunchStatus, LaunchTask } from '@/lib/shared/launch-checklist'

afterEach(cleanup)

const task = (extra: Partial<LaunchTask>) =>
  ({
    id: 'connect-messenger',
    title: 'Connect Messenger',
    classification: 'prerequisite',
    isCompleted: false,
    isSkipped: false,
    availability: 'available',
    href: '/admin/settings/widget/install',
    ...extra,
  }) as LaunchTask

const show = (t: LaunchTask) =>
  render(
    <IntlProvider locale="en" defaultLocale="en" onError={() => {}}>
      <LaunchStepAction task={t} status={{} as LaunchStatus} primary onCreateBoard={() => {}} />
    </IntlProvider>
  )

describe('a launch step done in place', () => {
  it('opens its going-live sheet instead of navigating', () => {
    const heard: unknown[] = []
    const listen = (event: Event) => heard.push((event as CustomEvent).detail)
    window.addEventListener(OPEN_GOING_LIVE_EVENT, listen)
    show(task({ sheet: 'invite-team' }))
    expect(screen.queryByRole('link')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    window.removeEventListener(OPEN_GOING_LIVE_EVENT, listen)
    expect(heard).toEqual(['invite-team'])
  })

  it('still links to the page when the step has no sheet', () => {
    show(task({}))
    expect(screen.getByRole('link', { name: 'Start' }).getAttribute('href')).toBe(
      '/admin/settings/widget/install'
    )
  })
})

describe('the first article, from the launch plan', () => {
  it('publishes in place: a Published toast, and the plan moves on without leaving', async () => {
    const client = new QueryClient()
    client.setQueryData(['admin', 'onboarding'], {})
    render(
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" defaultLocale="en" onError={() => {}}>
          <LaunchStepAction
            task={task({ id: 'help-article', href: '/admin/help-center' })}
            status={{} as LaunchStatus}
            primary
            onCreateBoard={() => {}}
          />
        </IntlProvider>
      </QueryClientProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Write article' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(article.toast).toHaveBeenCalledWith('Article published'))
    expect(client.getQueryState(['admin', 'onboarding'])?.isInvalidated).toBe(true)
  })
})
