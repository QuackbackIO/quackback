/**
 * POST /api/unsubscribe: the RFC 8058 one-click endpoint named in every token
 * email's List-Unsubscribe header. Mail clients POST
 * `List-Unsubscribe=One-Click` to the URL from the header; the token in the
 * query is the only credential, as it is for the confirm page.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))

const spend = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/domains/subscriptions/subscription.service', () => ({
  processUnsubscribeToken: (...args: unknown[]) => spend(...args),
}))

import { Route } from '../unsubscribe'

type Handler = (args: { request: Request }) => Promise<Response> | Response
type Handlers = { GET: Handler; POST: Handler }
const { GET, POST } = (Route as unknown as { options: { server: { handlers: Handlers } } }).options
  .server.handlers

const TOKEN = '6f1c1c47-3c0e-4d55-9a43-0d2a4f1c9b10'

function oneClick(query: string): Request {
  return new Request(`https://acme.quackback.test/api/unsubscribe${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'List-Unsubscribe=One-Click',
  })
}

beforeEach(() => spend.mockReset())

describe('POST /api/unsubscribe (one-click)', () => {
  it('spends the token in the query and answers 200', async () => {
    spend.mockResolvedValue({ action: 'unsubscribe_onboarding' })

    const res = await POST({ request: oneClick(`?token=${TOKEN}`) })

    expect(res.status).toBe(200)
    expect(spend).toHaveBeenCalledWith(TOKEN)
  })

  it('answers 410 for a used, expired or unknown token', async () => {
    spend.mockResolvedValue(null)

    const res = await POST({ request: oneClick(`?token=${TOKEN}`) })

    expect(res.status).toBe(410)
  })

  it('rejects a missing or malformed token without touching the database', async () => {
    expect((await POST({ request: oneClick('') })).status).toBe(400)
    expect((await POST({ request: oneClick('?token=../../etc') })).status).toBe(400)
    expect(spend).not.toHaveBeenCalled()
  })
})

describe('GET /api/unsubscribe (clients without one-click)', () => {
  const open = (query: string) =>
    GET({ request: new Request(`https://acme.quackback.test/api/unsubscribe${query}`) })

  it('sends the person to the confirm page with the token, without spending it', async () => {
    const res = await open(`?token=${TOKEN}`)

    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(`/unsubscribe?token=${TOKEN}`)
    expect(spend).not.toHaveBeenCalled()
  })

  it('carries nothing but the token to the confirm page', async () => {
    const res = await open(`?token=${TOKEN}&next=https://evil.example`)
    expect(res.headers.get('location')).toBe(`/unsubscribe?token=${TOKEN}`)
    expect((await open('')).headers.get('location')).toBe('/unsubscribe')
    expect(spend).not.toHaveBeenCalled()
  })
})
