// @vitest-environment happy-dom
/**
 * The follow bell reads its status on mount, so an unsubscribe from an email
 * shows up, unless the status was just read with the page (the admin post
 * modal's panel), where a second read would only repeat it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import type { PostId } from '@quackback/ids'

vi.mock('@/lib/server/functions/subscriptions', () => ({
  fetchSubscriptionStatus: vi.fn(),
  subscribeToPostFn: vi.fn(),
  unsubscribeFromPostFn: vi.fn(),
  updateSubscriptionLevelFn: vi.fn(),
}))

import { fetchSubscriptionStatus } from '@/lib/server/functions/subscriptions'
import { SubscriptionBell } from '../subscription-bell'

const POST = 'post_1' as PostId
const FOLLOWING = { subscribed: true, level: 'all', reason: 'manual' } as const

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderBell(props: Partial<Parameters<typeof SubscriptionBell>[0]>) {
  render(
    <IntlProvider locale="en-US" messages={{}}>
      <SubscriptionBell postId={POST} {...props} />
    </IntlProvider>
  )
}

describe('SubscriptionBell', () => {
  it('shows a status read with the page without reading it again', () => {
    renderBell({ initialStatus: FOLLOWING, initialStatusFresh: true })

    expect(screen.getByLabelText('Subscribed to all activity')).toBeTruthy()
    expect(fetchSubscriptionStatus).not.toHaveBeenCalled()
  })

  it('reads the status on mount otherwise', async () => {
    vi.mocked(fetchSubscriptionStatus).mockResolvedValue(FOLLOWING as never)

    renderBell({})

    expect(await screen.findByLabelText('Subscribed to all activity')).toBeTruthy()
    expect(fetchSubscriptionStatus).toHaveBeenCalledTimes(1)
  })
})
