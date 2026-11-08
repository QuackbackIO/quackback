// @vitest-environment happy-dom
/**
 * Subscribe by email is the changelog's leading action: filled for a visitor
 * who can subscribe, and offered to one not signed in as the way to sign in.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

vi.mock('@/lib/server/functions/changelog-subscriptions', () => ({
  subscribeToChangelogFn: vi.fn(),
  unsubscribeFromChangelogFn: vi.fn(),
  getMyChangelogSubscriptionFn: vi.fn(async () => ({ subscribed: false })),
}))

import { ChangelogSubscribeButton } from '../changelog-subscribe-button'

afterEach(cleanup)

function draw(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en">{ui}</IntlProvider>
    </QueryClientProvider>
  )
}

describe('ChangelogSubscribeButton', () => {
  it('offers Subscribe to a visitor not signed in, as the way to sign in', () => {
    const onSignIn = vi.fn()
    draw(<ChangelogSubscribeButton enabled={false} onSignIn={onSignIn} />)
    fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }))
    expect(onSignIn).toHaveBeenCalledTimes(1)
  })

  it('offers nothing to a visitor not signed in where signing in is not offered', () => {
    draw(<ChangelogSubscribeButton enabled={false} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('leads, filled, for a visitor who can subscribe', () => {
    draw(<ChangelogSubscribeButton enabled />)
    const button = screen.getByRole('button', { name: 'Subscribe' })
    expect(button.getAttribute('data-variant')).toBe('default')
  })
})
