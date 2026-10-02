// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { TooltipProvider } from '@/components/ui/tooltip'

vi.mock('@/lib/client/hooks/use-notifications-queries', () => ({
  useUnreadCount: () => ({ data: 0 }),
}))
vi.mock('../notification-dropdown', () => ({ NotificationDropdown: () => null }))

import { NotificationBell } from '../notification-bell'

afterEach(cleanup)

describe('NotificationBell', () => {
  it('draws a solid icon, like every other rail item', () => {
    render(
      <IntlProvider locale="en" defaultLocale="en">
        <TooltipProvider>
          <NotificationBell />
        </TooltipProvider>
      </IntlProvider>
    )
    const svg = screen.getByRole('button', { name: 'Notifications' }).querySelector('svg')!
    expect(svg.getAttribute('fill')).toBe('currentColor')
  })

  it('marks the labeled rail item active on the notifications page', () => {
    render(
      <IntlProvider locale="en" defaultLocale="en">
        <TooltipProvider>
          <NotificationBell labeled active />
        </TooltipProvider>
      </IntlProvider>
    )
    const button = screen.getByRole('button', { name: 'Notifications' })
    expect(button.getAttribute('data-active')).toBe('true')
    expect(button.className).toContain('bg-chrome-active')
  })

  it('is not active by default', () => {
    render(
      <IntlProvider locale="en" defaultLocale="en">
        <TooltipProvider>
          <NotificationBell labeled />
        </TooltipProvider>
      </IntlProvider>
    )
    expect(
      screen.getByRole('button', { name: 'Notifications' }).getAttribute('data-active')
    ).toBeNull()
  })
})
