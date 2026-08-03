// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the auth-headers helper before importing the module under test.
vi.mock('@/lib/client/widget-auth', () => ({
  getWidgetAuthHeaders: () => ({ Authorization: 'Bearer test-token' }),
}))

import {
  createWidgetTicket,
  getWidgetTicket,
  listWidgetTickets,
  replyToWidgetTicket,
  resolveWidgetTicket,
  updateWidgetTicketDescription,
  WidgetTicketError,
} from '../tickets-api'

const originalFetch = globalThis.fetch

function mockFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = vi.fn(impl) as unknown as typeof fetch
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('widget tickets-api', () => {
  it('listWidgetTickets injects bearer + parses data', async () => {
    let capturedUrl = ''
    let capturedHeaders: Record<string, string> = {}
    mockFetch(async (input, init) => {
      capturedUrl = String(input)
      capturedHeaders = init?.headers as Record<string, string>
      return new Response(
        JSON.stringify({ data: { rows: [{ id: 't1', subject: 'Hi' }], total: 1 } }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    })
    const out = await listWidgetTickets({ statusCategory: 'open', limit: 10 })
    expect(out.total).toBe(1)
    expect(out.rows[0].subject).toBe('Hi')
    expect(capturedUrl).toContain('/api/widget/tickets?')
    expect(capturedUrl).toContain('statusCategory=open')
    expect(capturedUrl).toContain('limit=10')
    expect(capturedHeaders.Authorization).toBe('Bearer test-token')
  })

  it('getWidgetTicket encodes the path segment', async () => {
    let capturedUrl = ''
    mockFetch(async (input) => {
      capturedUrl = String(input)
      return new Response(JSON.stringify({ data: { ticket: { id: 't1' } } }), { status: 200 })
    })
    await getWidgetTicket('ticket_abc/with space')
    expect(capturedUrl).toBe('/api/widget/tickets/ticket_abc%2Fwith%20space')
  })

  it('createWidgetTicket sends JSON body with content-type', async () => {
    let capturedHeaders: Record<string, string> = {}
    let capturedBody = ''
    mockFetch(async (_input, init) => {
      capturedHeaders = init?.headers as Record<string, string>
      capturedBody = init?.body as string
      return new Response(JSON.stringify({ data: { id: 't1', subject: 'S' } }), { status: 200 })
    })
    await createWidgetTicket({ subject: 'S', bodyText: 'B', priority: 'high' })
    expect(capturedHeaders['Content-Type']).toBe('application/json')
    expect(capturedHeaders.Authorization).toBe('Bearer test-token')
    const parsed = JSON.parse(capturedBody)
    expect(parsed).toEqual({ subject: 'S', bodyText: 'B', priority: 'high' })
  })

  it('replyToWidgetTicket POSTs bodyText to /replies', async () => {
    let capturedUrl = ''
    let capturedBody = ''
    mockFetch(async (input, init) => {
      capturedUrl = String(input)
      capturedBody = init?.body as string
      return new Response(JSON.stringify({ data: { id: 'th1' } }), { status: 200 })
    })
    await replyToWidgetTicket('t_1', 'hello')
    expect(capturedUrl).toBe('/api/widget/tickets/t_1/replies')
    expect(JSON.parse(capturedBody)).toEqual({ bodyText: 'hello' })
  })

  it('updateWidgetTicketDescription PATCHes description with optimistic timestamp', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody = ''
    mockFetch(async (input, init) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedBody = init?.body as string
      return new Response(
        JSON.stringify({ data: { id: 't_1', updatedAt: '2026-01-01T00:00:01Z' } }),
        {
          status: 200,
        }
      )
    })
    await updateWidgetTicketDescription('t_1', {
      expectedUpdatedAt: '2026-01-01T00:00:00Z',
      descriptionJson: { type: 'doc', content: [] },
      descriptionText: 'updated',
    })
    expect(capturedUrl).toBe('/api/widget/tickets/t_1')
    expect(capturedMethod).toBe('PATCH')
    expect(JSON.parse(capturedBody)).toEqual({
      expectedUpdatedAt: '2026-01-01T00:00:00Z',
      descriptionJson: { type: 'doc', content: [] },
      descriptionText: 'updated',
    })
  })

  it('resolveWidgetTicket POSTs to /resolve and returns alreadyResolved', async () => {
    mockFetch(
      async () =>
        new Response(
          JSON.stringify({
            data: { id: 't1', statusId: 's1', statusCategory: 'solved', alreadyResolved: true },
          }),
          { status: 200 }
        )
    )
    const out = await resolveWidgetTicket('t1')
    expect(out.alreadyResolved).toBe(true)
  })

  it('throws typed WidgetTicketError on non-2xx', async () => {
    mockFetch(
      async () =>
        new Response(JSON.stringify({ code: 'IDENTITY_REQUIRED', message: 'need identity' }), {
          status: 403,
        })
    )
    await expect(listWidgetTickets()).rejects.toMatchObject({
      name: 'WidgetTicketError',
      code: 'IDENTITY_REQUIRED',
      status: 403,
      message: 'need identity',
    })
  })

  it('uses fallback error code when body has no envelope', async () => {
    mockFetch(async () => new Response('{}', { status: 500 }))
    try {
      await listWidgetTickets()
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(WidgetTicketError)
      expect((err as WidgetTicketError).code).toBe('UNKNOWN')
      expect((err as WidgetTicketError).status).toBe(500)
    }
  })
})
