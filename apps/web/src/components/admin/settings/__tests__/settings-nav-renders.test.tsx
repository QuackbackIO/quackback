// @vitest-environment happy-dom
/**
 * The settings nav stays mounted while the admin moves between settings
 * pages. A navigation changes which link is active, so only the link that
 * stops being active and the one that becomes active may render again, not
 * every link in the nav.
 */
import { act, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useSyncExternalStore } from 'react'
import { describe, expect, it, vi } from 'vitest'

const { location, linkRenders } = vi.hoisted(() => {
  let pathname = '/admin/settings/general'
  const listeners = new Set<() => void>()
  return {
    linkRenders: [] as string[],
    location: {
      get: () => pathname,
      set(next: string) {
        pathname = next
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
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
    select({
      location: { pathname: useSyncExternalStore(location.subscribe, location.get, location.get) },
    }),
  useRouteContext: () => ({
    settings: { featureFlags: { feedback: true, changelog: true } },
    billingEnabled: false,
    cloudEnabled: false,
  }),
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => {
    linkRenders.push(to)
    return (
      <a href={to} data-active={(rest as { 'data-active'?: boolean })['data-active']}>
        {children}
      </a>
    )
  },
}))

vi.mock('@/lib/client/hooks/use-visual-theme', () => ({ useRefinedTheme: () => false }))

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
    act(() => location.set('/admin/settings/members'))

    expect(linkRenders.sort()).toEqual(['/admin/settings/general', '/admin/settings/members'])
    expect(
      container.querySelector('a[href="/admin/settings/members"]')?.getAttribute('data-active')
    ).toBe('true')
    expect(
      container.querySelector('a[href="/admin/settings/general"]')?.hasAttribute('data-active')
    ).toBe(false)
  })
})
