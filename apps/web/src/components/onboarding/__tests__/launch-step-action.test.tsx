// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}))

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
