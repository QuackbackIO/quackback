// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSDK } from '../src/core/sdk'

const ORIGIN = 'https://feedback.acme.com'

function stubIframe() {
  const postMessage = vi.fn()
  const spy = vi
    .spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get')
    .mockReturnValue({ postMessage } as unknown as Window)
  return { postMessage, spy }
}

function fireReady() {
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: ORIGIN,
      data: { type: 'quackback:ready' },
    })
  )
}

describe('sdk: ticketing surface', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    document.head.innerHTML = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ theme: {} }) }))
    )
  })
  afterEach(() => vi.restoreAllMocks())

  it('openSupport() posts view: support to the iframe and emits an open event', () => {
    const { postMessage, spy } = stubIframe()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    fireReady()
    const seen: unknown[] = []
    sdk.dispatch('on', 'open', (p: unknown) => seen.push(p))

    sdk.dispatch('openSupport')

    expect(postMessage).toHaveBeenCalledWith(
      { type: 'quackback:open', data: { view: 'support' } },
      ORIGIN
    )
    expect(seen).toHaveLength(1)
    expect((seen[0] as { view?: string }).view).toBe('support')
    expect((seen[0] as { ticketId?: string }).ticketId).toBeUndefined()
    spy.mockRestore()
  })

  it('openSupport(ticketId) deep-links into the ticket detail and surfaces ticketId', () => {
    const { postMessage, spy } = stubIframe()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    fireReady()
    const seen: unknown[] = []
    sdk.dispatch('on', 'open', (p: unknown) => seen.push(p))

    sdk.dispatch('openSupport', 'ticket_01h')

    expect(postMessage).toHaveBeenCalledWith(
      { type: 'quackback:open', data: { view: 'support', ticketId: 'ticket_01h' } },
      ORIGIN
    )
    expect(seen[0] as { view?: string; ticketId?: string }).toMatchObject({
      view: 'support',
      ticketId: 'ticket_01h',
    })
    spy.mockRestore()
  })

  it('open({ view: support, ticketId }) round-trips ticketId into the open event', () => {
    const { postMessage, spy } = stubIframe()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    fireReady()
    const seen: unknown[] = []
    sdk.dispatch('on', 'open', (p: unknown) => seen.push(p))

    sdk.dispatch('open', { view: 'support', ticketId: 'ticket_42' })

    expect(postMessage).toHaveBeenCalledWith(
      { type: 'quackback:open', data: { view: 'support', ticketId: 'ticket_42' } },
      ORIGIN
    )
    expect((seen[0] as { ticketId?: string }).ticketId).toBe('ticket_42')
    spy.mockRestore()
  })

  it('forwards inbound ticket:created events to subscribers', () => {
    stubIframe()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    const seen: unknown[] = []
    sdk.dispatch('on', 'ticket:created', (p: unknown) => seen.push(p))
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: ORIGIN,
        data: {
          type: 'quackback:event',
          name: 'ticket:created',
          payload: {
            id: 'ticket_1',
            subject: 'Help',
            statusId: 'status_1',
            statusCategory: 'open',
          },
        },
      })
    )
    expect(seen).toEqual([
      {
        id: 'ticket_1',
        subject: 'Help',
        statusId: 'status_1',
        statusCategory: 'open',
      },
    ])
  })

  it('forwards inbound ticket:replied events to subscribers', () => {
    stubIframe()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    const seen: unknown[] = []
    sdk.dispatch('on', 'ticket:replied', (p: unknown) => seen.push(p))
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: ORIGIN,
        data: {
          type: 'quackback:event',
          name: 'ticket:replied',
          payload: { ticketId: 'ticket_1', threadId: 'thread_2' },
        },
      })
    )
    expect(seen).toEqual([{ ticketId: 'ticket_1', threadId: 'thread_2' }])
  })

  it('forwards inbound ticket:resolved events to subscribers', () => {
    stubIframe()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    const seen: unknown[] = []
    sdk.dispatch('on', 'ticket:resolved', (p: unknown) => seen.push(p))
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: ORIGIN,
        data: {
          type: 'quackback:event',
          name: 'ticket:resolved',
          payload: { ticketId: 'ticket_1', statusId: 'status_solved', alreadyResolved: false },
        },
      })
    )
    expect(seen).toEqual([
      { ticketId: 'ticket_1', statusId: 'status_solved', alreadyResolved: false },
    ])
  })
})
