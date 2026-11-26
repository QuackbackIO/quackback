// @vitest-environment happy-dom
/**
 * The frame side of the reply preview: the localised payload for the card
 * above the closed launcher, sent only when the workspace shows a card and
 * only when it changes, the tab title text sent only when that is on, and
 * the unread read that refreshes when the page is visible again.
 */
import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { sendToHost, unreadFn, replyFn, auth } = vi.hoisted(() => ({
  sendToHost: vi.fn(),
  unreadFn: vi.fn(),
  replyFn: vi.fn(),
  auth: { sessionVersion: 1 },
}))
vi.mock('@/lib/client/widget-bridge', () => ({ sendToHost }))
vi.mock('@/lib/server/functions/widget/conversation', () => ({
  widgetGetMessengerUnreadFn: unreadFn,
  widgetGetReplyPreviewFn: replyFn,
}))
vi.mock('@/lib/client/widget-auth', () => ({ getWidgetAuthHeaders: () => ({}) }))
vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => ({ sessionVersion: auth.sessionVersion }),
}))

import {
  buildReplyPreview,
  useReplyPreviewAnnouncement,
  useUnreadReplies,
  type ReplyAlerts,
  type UnreadReplies,
} from '../reply-preview'
import { useMessengerUnread } from '../use-messenger-unread'
import de from '@/locales/de.json'
import { createIntl } from 'react-intl'

const replies: UnreadReplies = {
  conversationId: 'conversation_1',
  author: { name: 'Alex Kim', avatarUrl: '/api/storage/avatars/alex.png' },
  teamName: 'Acme',
  count: 2,
  messages: [
    { id: 'conversation_msg_1', text: 'Thanks for waiting', createdAt: '2026-11-20T10:00:00.000Z' },
    {
      id: 'conversation_msg_2',
      text: 'We found the cause. '.repeat(20).trim(),
      createdAt: '2026-11-20T10:01:00.000Z',
    },
  ],
}

const intl = (locale = 'en', messages?: Record<string, string>) =>
  createIntl({ locale, messages, timeZone: 'UTC' })

function wrapper({ children }: { children: ReactNode }) {
  return (
    <IntlProvider locale="en" timeZone="UTC">
      {children}
    </IntlProvider>
  )
}

type Settings = { replyAlerts: ReplyAlerts; titleAlerts: boolean }
type State = Parameters<typeof useReplyPreviewAnnouncement>[1]

function run(settings: Settings, state: State) {
  return renderHook(
    ({ settings: s, state: st }: { settings: Settings; state: State }) =>
      useReplyPreviewAnnouncement(s, st),
    { initialProps: { settings, state }, wrapper }
  )
}

const sent = (type: string) =>
  sendToHost.mock.calls.map(([m]) => m as Record<string, unknown>).filter((m) => m.type === type)

beforeEach(() => {
  sendToHost.mockClear()
  unreadFn.mockReset()
  replyFn.mockReset()
  auth.sessionVersion = 1
})

function withClient() {
  const client = new QueryClient()
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper: Wrapper }
}

describe('buildReplyPreview', () => {
  it('names the author from the team, cuts long replies at a word and resolves the avatar', () => {
    const payload = buildReplyPreview(intl(), replies, false)
    expect(payload.author).toEqual({
      name: 'Alex Kim',
      firstName: 'Alex',
      avatarUrl: `${window.location.origin}/api/storage/avatars/alex.png`,
    })
    expect(payload.strings).toEqual({
      header: 'Alex from Acme',
      replyTo: 'Reply to Alex…',
      newReplies: '2 new replies',
      dismiss: 'Dismiss',
      label: 'New reply from Alex',
      announce: 'New reply from Alex',
    })
    expect(payload.messages[0].text).toBe('Thanks for waiting')
    const cut = payload.messages[1].text
    expect(cut.endsWith('…')).toBe(true)
    expect(Array.from(cut).length).toBeLessThanOrEqual(181)
    expect(cut).not.toMatch(/ \S{1,3}…$/)
    expect(payload.full).toBe(false)
  })

  it('keeps the whole reply when the workspace shows it in full', () => {
    const payload = buildReplyPreview(intl(), replies, true)
    expect(payload.messages[1].text).toBe(replies.messages[1].text)
    expect(payload.full).toBe(true)
  })

  it('reads as the team when the reply has no person behind it', () => {
    const payload = buildReplyPreview(
      intl(),
      { ...replies, author: { name: null, avatarUrl: null } },
      false
    )
    expect(payload.strings.header).toBe('Acme')
    expect(payload.strings.replyTo).toBe('Reply to Acme…')
    expect(payload.author.avatarUrl).toBeNull()
  })

  it('names a reply with only attachments', () => {
    const payload = buildReplyPreview(
      intl(),
      { ...replies, messages: [{ id: 'm', text: '', createdAt: '' }] },
      false
    )
    expect(payload.messages[0].text).toBe('Sent an attachment')
  })

  it('speaks the visitor language', () => {
    const payload = buildReplyPreview(intl('de', de), replies, false)
    expect(payload.strings.header).toBe(
      de['widget.replyPreview.header'].replace('{name}', 'Alex').replace('{team}', 'Acme')
    )
    expect(payload.strings.newReplies).not.toBe('2 new replies')
  })
})

describe('useReplyPreviewAnnouncement', () => {
  it('sends the preview once per change, and null once nothing is unread', () => {
    const { rerender } = run(
      { replyAlerts: 'preview', titleAlerts: false },
      { ready: true, data: replies, session: 1 }
    )
    expect(sent('quackback:reply-preview')).toHaveLength(1)
    expect(sent('quackback:reply-preview')[0].replyPreview).toMatchObject({
      conversationId: 'conversation_1',
      count: 2,
    })
    rerender({
      settings: { replyAlerts: 'preview', titleAlerts: false },
      state: { ready: true, data: { ...replies }, session: 1 },
    })
    expect(sent('quackback:reply-preview')).toHaveLength(1)
    rerender({
      settings: { replyAlerts: 'preview', titleAlerts: false },
      state: { ready: true, data: null, session: 1 },
    })
    expect(sent('quackback:reply-preview').at(-1)).toEqual({
      type: 'quackback:reply-preview',
      replyPreview: null,
    })
    expect(sent('quackback:title-alert')).toHaveLength(0)
  })

  it('sends again for a new session, even with the same replies', () => {
    const { rerender } = run(
      { replyAlerts: 'preview', titleAlerts: false },
      { ready: true, data: replies, session: 1 }
    )
    rerender({
      settings: { replyAlerts: 'preview', titleAlerts: false },
      state: { ready: true, data: replies, session: 2 },
    })
    expect(sent('quackback:reply-preview')).toHaveLength(2)
  })

  it('waits until the replies are read', () => {
    run({ replyAlerts: 'preview', titleAlerts: true }, { ready: false, data: null, session: 1 })
    expect(sendToHost).not.toHaveBeenCalled()
  })

  it('sends no card with the badge only, and drops one sent before', () => {
    const { rerender } = run(
      { replyAlerts: 'badge', titleAlerts: false },
      { ready: true, data: replies, session: 1 }
    )
    expect(sendToHost).not.toHaveBeenCalled()
    rerender({
      settings: { replyAlerts: 'full', titleAlerts: false },
      state: { ready: true, data: replies, session: 1 },
    })
    expect(sent('quackback:reply-preview').at(-1)?.replyPreview).toMatchObject({ full: true })
    rerender({
      settings: { replyAlerts: 'badge', titleAlerts: false },
      state: { ready: true, data: replies, session: 1 },
    })
    expect(sent('quackback:reply-preview').at(-1)).toEqual({
      type: 'quackback:reply-preview',
      replyPreview: null,
    })
  })

  it('sends the tab title text only while that is on, without message text', () => {
    const { rerender } = run(
      { replyAlerts: 'badge', titleAlerts: true },
      { ready: true, data: replies, session: 1 }
    )
    expect(sent('quackback:reply-preview')).toHaveLength(0)
    expect(sent('quackback:title-alert')).toEqual([
      { type: 'quackback:title-alert', text: 'Alex replied' },
    ])
    rerender({
      settings: { replyAlerts: 'badge', titleAlerts: true },
      state: { ready: true, data: null, session: 1 },
    })
    expect(sent('quackback:title-alert').at(-1)).toEqual({
      type: 'quackback:title-alert',
      text: null,
    })
  })
})

describe('useMessengerUnread freshness', () => {
  it('reads again the moment the page is visible, not on the next poll', async () => {
    unreadFn.mockResolvedValue({ conversations: 1, total: 1 })
    const client = new QueryClient()
    const { result } = renderHook(() => useMessengerUnread(true), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    })
    await waitFor(() => expect(result.current).toBe(1))
    expect(unreadFn).toHaveBeenCalledTimes(1)
    unreadFn.mockResolvedValue({ conversations: 3, total: 3 })
    let hidden = true
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (hidden ? 'hidden' : 'visible'),
    })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    hidden = false
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await waitFor(() => expect(result.current).toBe(3))
    delete (document as { visibilityState?: unknown }).visibilityState
    client.clear()
  })
})

describe('useMessengerUnread in the background', () => {
  async function pollsWhileHidden(background: boolean): Promise<number> {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    unreadFn.mockResolvedValue({ conversations: 1, total: 1 })
    const { client, wrapper: w } = withClient()
    renderHook(() => useMessengerUnread(true, { background }), { wrapper: w })
    await vi.advanceTimersByTimeAsync(0)
    const before = unreadFn.mock.calls.length
    focusManager.setFocused(false)
    await vi.advanceTimersByTimeAsync(61_000)
    const polled = unreadFn.mock.calls.length - before
    focusManager.setFocused(undefined)
    client.clear()
    vi.useRealTimers()
    return polled
  }

  it('keeps polling while the page is hidden only when asked, for the tab title', async () => {
    expect(await pollsWhileHidden(true)).toBeGreaterThanOrEqual(2)
    expect(await pollsWhileHidden(false)).toBe(0)
  })
})

describe('useUnreadReplies', () => {
  it('reads nothing while nothing is unread', () => {
    const { wrapper: w } = withClient()
    const { result } = renderHook(() => useUnreadReplies(true, 0), { wrapper: w })
    expect(result.current).toEqual({ ready: true, data: null })
    expect(replyFn).not.toHaveBeenCalled()
  })

  it("never carries the previous visitor's replies into a new session", async () => {
    replyFn.mockResolvedValue(replies)
    const { client, wrapper: w } = withClient()
    const { result, rerender } = renderHook(
      ({ unread }: { unread: number }) => useUnreadReplies(true, unread),
      { wrapper: w, initialProps: { unread: 2 } }
    )
    await waitFor(() => expect(result.current.data).toEqual(replies))
    // A newer count keeps the card while the next read loads...
    replyFn.mockReturnValue(new Promise(() => {}))
    rerender({ unread: 3 })
    expect(result.current.data).toEqual(replies)
    // ...but a new session starts empty.
    auth.sessionVersion = 2
    rerender({ unread: 3 })
    expect(result.current).toEqual({ ready: false, data: null })
    client.clear()
  })
})
