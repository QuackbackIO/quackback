// @vitest-environment happy-dom
/**
 * The settings nav stays mounted while the admin moves between settings
 * pages. A navigation changes which link is active, so only the link that
 * stops being active and the one that becomes active may render again, not
 * every link in the nav, and not the nav around them. Each navigation also
 * hands the tree a new route context object whose parts are unchanged.
 */
import { act, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useSyncExternalStore } from 'react'
import { describe, expect, it, vi } from 'vitest'

const { location, linkRenders, navRenders } = vi.hoisted(() => {
  let pathname = '/admin/settings/general'
  const parts = {
    settings: { featureFlags: { feedback: true, changelog: true } },
    billingEnabled: false,
    cloudEnabled: false,
    // An admin's: every page the nav lists is one it may open.
    permissions: [
      'settings.manage',
      'settings.branding',
      'member.view',
      'auth.manage',
      'api_key.manage',
      'integration.view',
      'user_attribute.view',
      'company.view',
    ],
  }
  let context = { ...parts }
  const listeners = new Set<() => void>()
  return {
    linkRenders: [] as string[],
    navRenders: { count: 0 },
    location: {
      get: () => pathname,
      getContext: () => context,
      set(next: string) {
        pathname = next
        context = { ...parts }
        for (const l of listeners) l()
      },
      subscribe(listener: () => void) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
  }
})

vi.mock('@tanstack/react-router', () => ({
  // Like the router's own hooks, a caller renders again only when what it
  // selected changes.
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) => {
    const read = () => select({ location: { pathname: location.get() } })
    return useSyncExternalStore(location.subscribe, read, read)
  },
  useRouteContext: ({ select }: { select?: (context: unknown) => unknown }) => {
    const read = () => (select ? select(location.getContext()) : location.getContext())
    return useSyncExternalStore(location.subscribe, read, read)
  },
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => {
    linkRenders.push(to)
    return (
      <a href={to} data-active={(rest as { 'data-active'?: boolean })['data-active']}>
        {children}
      </a>
    )
  },
}))

// Only the nav itself asks for the theme, so this counts the nav's renders.
vi.mock('@/lib/client/hooks/use-root-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/client/hooks/use-root-context')>()),
  useRefinedTheme: () => {
    navRenders.count++
    return false
  },
}))

import { SettingsNav } from '../settings-nav'

describe('SettingsNav', () => {
  it('re-renders only the links whose active state a navigation changes', () => {
    const { container } = render(<SettingsNav />)
    const links = linkRenders.length
    expect(links).toBeGreaterThan(8)
    expect(
      container.querySelector('a[href="/admin/settings/general"]')?.getAttribute('data-active')
    ).toBe('true')

    linkRenders.length = 0
    navRenders.count = 0
    act(() => location.set('/admin/settings/members'))

    expect(linkRenders.sort()).toEqual(['/admin/settings/general', '/admin/settings/members'])
    expect(navRenders.count).toBe(0)
    expect(
      container.querySelector('a[href="/admin/settings/members"]')?.getAttribute('data-active')
    ).toBe('true')
    expect(
      container.querySelector('a[href="/admin/settings/general"]')?.hasAttribute('data-active')
    ).toBe(false)
  })
})
