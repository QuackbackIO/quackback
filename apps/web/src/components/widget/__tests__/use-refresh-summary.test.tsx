// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import { conversationKeys } from '@/lib/client/queries/conversation-keys'

const myConversation = vi.fn()

vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => ({ sessionVersion: 0 }),
}))
vi.mock('@/lib/client/widget-auth', () => ({ getWidgetAuthHeaders: () => ({}) }))
vi.mock('@/lib/server/functions/widget/conversation', () => ({
  widgetGetMessengerUnreadFn: () => new Promise(() => {}),
  widgetGetMyConversationFn: () => myConversation(),
  widgetGetConversationPresenceFn: () => new Promise(() => {}),
}))

import { useRefreshSummaryOnUnreadChange } from '../use-messenger-unread'
import { useConversationSummary } from '../use-messenger-summary'
import { refreshVisitorUnreadCounts } from '@/lib/client/conversation/visitor-read'

const summary = (teamName: string) => ({ conversation: null, teamName })
const current = conversationKeys.widgetConversationSummary(0)

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <IntlProvider locale="en" messages={{}}>
        {children}
      </IntlProvider>
    </QueryClientProvider>
  )
  const refresher = () =>
    renderHook(
      ({ total }: { total: number | undefined }) => useRefreshSummaryOnUnreadChange(total, true),
      { wrapper, initialProps: { total: 2 as number | undefined } }
    )
  return { qc, wrapper, refresher }
}

beforeEach(() => {
  myConversation.mockReset()
  myConversation.mockResolvedValue(summary('fresh'))
})

describe('useRefreshSummaryOnUnreadChange', () => {
  it('refetches the current Home card when the total moves, even with Home off screen', async () => {
    const { qc, refresher } = setup()
    const older = vi.fn().mockResolvedValue(summary('older'))
    // Fetched but not observed: Home is off screen.
    await qc.fetchQuery({ queryKey: current, queryFn: () => summary('stale') })
    await qc.fetchQuery({
      queryKey: conversationKeys.widgetConversationSummary(-1),
      queryFn: older,
    })
    older.mockClear()
    const hook = refresher()
    hook.rerender({ total: 0 })
    await vi.waitFor(() => expect(qc.getQueryData(current)).toEqual(summary('fresh')))
    // An earlier identity's card is left alone.
    expect(older).not.toHaveBeenCalled()
  })

  it('refreshes a card seeded by the loader that nobody has shown yet', async () => {
    const { qc, refresher } = setup()
    // The loader seeds the key with data only, no fetch function.
    qc.setQueryData(current, summary('seeded'))
    const hook = refresher()
    hook.rerender({ total: 0 })
    await vi.waitFor(() => expect(qc.getQueryData(current)).toEqual(summary('fresh')))
    expect(qc.getQueryState(current)?.status).toBe('success')
    expect(myConversation).toHaveBeenCalledTimes(1)
  })

  it('does not count the first total after a load as a change', async () => {
    const { qc, wrapper } = setup()
    await qc.fetchQuery({ queryKey: current, queryFn: () => summary('stale') })
    const hook = renderHook(
      ({ total }: { total: number | undefined }) => useRefreshSummaryOnUnreadChange(total, true),
      { wrapper, initialProps: { total: undefined as number | undefined } }
    )
    hook.rerender({ total: 2 })
    await new Promise((r) => setTimeout(r, 20))
    expect(myConversation).not.toHaveBeenCalled()
    expect(qc.getQueryState(current)?.isInvalidated).toBe(false)
  })

  it('a read that also moves the total fetches the Home card once', async () => {
    const { qc, wrapper, refresher } = setup()
    // Home is on screen.
    renderHook(() => useConversationSummary(true), { wrapper })
    await vi.waitFor(() => expect(qc.getQueryData(current)).toEqual(summary('fresh')))
    myConversation.mockClear()

    let finish: (value: unknown) => void = () => {}
    myConversation.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const hook = refresher()
    // The read refreshes the card, and the total it moved arrives meanwhile.
    refreshVisitorUnreadCounts(qc)
    hook.rerender({ total: 0 })
    finish(summary('after read'))
    await vi.waitFor(() => expect(qc.getQueryData(current)).toEqual(summary('after read')))
    expect(myConversation).toHaveBeenCalledTimes(1)
  })

  it('a drop after the card refreshed still fetches it, since a read elsewhere moves it too', async () => {
    const { qc, refresher } = setup()
    const hook = refresher()
    // The card was refreshed after the last total arrived, then a read in
    // another tab lowers the total.
    await new Promise((r) => setTimeout(r, 5))
    qc.setQueryData(current, summary('refreshed'))
    await new Promise((r) => setTimeout(r, 5))
    hook.rerender({ total: 0 })
    await vi.waitFor(() => expect(myConversation).toHaveBeenCalledTimes(1))
  })

  it('a widget without Home never fetches the card', async () => {
    const { qc, wrapper } = setup()
    qc.setQueryData(current, summary('seeded'))
    const hook = renderHook(
      ({ total }: { total: number | undefined }) => useRefreshSummaryOnUnreadChange(total, false),
      { wrapper, initialProps: { total: 2 as number | undefined } }
    )
    hook.rerender({ total: 0 })
    await new Promise((r) => setTimeout(r, 20))
    expect(myConversation).not.toHaveBeenCalled()
  })
})
