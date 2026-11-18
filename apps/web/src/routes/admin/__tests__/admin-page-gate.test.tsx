// @vitest-environment happy-dom
/**
 * A teammate without an admin page's main permission sees the no-access
 * state, and the page itself (whose reads the server would refuse) never
 * mounts. The sidebar hides the same pages, from the same keys.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentType } from 'react'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'

const viewer = vi.hoisted(() => ({ permissions: new Set<string>() }))

vi.mock('@/lib/client/hooks/use-root-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/client/hooks/use-root-context')>()),
  usePermissions: () => viewer.permissions,
}))

vi.mock('@/components/admin/feedback/inbox-container', () => ({
  InboxContainer: () => <div>feedback page</div>,
}))
vi.mock('@/components/admin/users/users-container', () => ({
  UsersContainer: () => <div>users page</div>,
}))
vi.mock('@/components/admin/changelog/changelog-list', () => ({
  ChangelogList: () => <div>changelog page</div>,
}))
vi.mock('@/components/admin/analytics/analytics-page', () => ({
  AnalyticsPage: () => <div>analytics page</div>,
}))
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Outlet: () => <div>help center page</div>,
}))

const { AdminPageGate } = await import('@/components/admin/admin-page-gate')

async function pageOf(path: string): Promise<ComponentType> {
  const { Route } = await import(/* @vite-ignore */ path)
  return (Route as { options: { component: ComponentType } }).options.component
}

afterEach(() => {
  cleanup()
  viewer.permissions = new Set()
})

const PAGES: Array<[string, string, PermissionKey]> = [
  ['@/routes/admin/feedback.index', 'feedback page', PERMISSIONS.POST_VIEW_PRIVATE],
  ['@/routes/admin/users', 'users page', PERMISSIONS.PEOPLE_VIEW],
  ['@/routes/admin/help-center', 'help center page', PERMISSIONS.HELP_CENTER_MANAGE],
  ['@/routes/admin/changelog', 'changelog page', PERMISSIONS.CHANGELOG_VIEW_DRAFT],
  ['@/routes/admin/analytics', 'analytics page', PERMISSIONS.ANALYTICS_VIEW],
]

describe('an admin page for a teammate without its permission', () => {
  it.each(PAGES)('%s shows the no-access state, not the page', async (path, page) => {
    // Everything a support-only role holds, and nothing these pages read.
    viewer.permissions = new Set([PERMISSIONS.CONVERSATION_VIEW, PERMISSIONS.TICKET_VIEW])
    window.history.pushState({}, '', '/admin/feedback')
    const Page = await pageOf(path)
    render(<Page />)

    expect(screen.getByRole('heading', { name: "You don't have access" })).toBeTruthy()
    expect(screen.queryByText(page)).toBeNull()
    expect(screen.getByRole('link', { name: 'Back to Home' }).getAttribute('href')).toBe('/admin')
  })

  // Feedback and Users read their loader data, so they are covered through
  // the gate below and the loader tests instead.
  it.each(PAGES.slice(2))('%s shows the page with its permission', async (path, page, key) => {
    viewer.permissions = new Set([key])
    const Page = await pageOf(path)
    render(<Page />)

    expect(screen.getByText(page)).toBeTruthy()
  })
})

describe('AdminPageGate', () => {
  it('renders the page for a viewer holding its permission', () => {
    viewer.permissions = new Set([PERMISSIONS.HELP_CENTER_MANAGE])
    render(
      <AdminPageGate page="/admin/help-center">
        <div>help center page</div>
      </AdminPageGate>
    )
    expect(screen.getByText('help center page')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: "You don't have access" })).toBeNull()
  })

  it('opens Status for either of its permissions', () => {
    viewer.permissions = new Set([PERMISSIONS.STATUS_PAGE_MANAGE])
    render(
      <AdminPageGate page="/admin/status">
        <div>status page</div>
      </AdminPageGate>
    )
    expect(screen.getByText('status page')).toBeTruthy()
  })
})
