import { describe, expect, it } from 'vitest'
import { generateId } from '@quackback/ids'

const { Route } = await import('../tickets')

type BeforeLoadFn = (ctx: {
  context: { settings: { featureFlags: Record<string, boolean> } | null }
  search: { t?: string }
}) => void

const beforeLoad = Route.options.beforeLoad as unknown as BeforeLoadFn

/**
 * The retired tickets page redirects before it renders anything, so a
 * document request answers with the redirect itself and the browser loads the
 * inbox directly, warmed by its loader on the server, instead of hydrating an
 * empty admin shell that then navigates on the client.
 */
function redirectOf(
  settings: { featureFlags: Record<string, boolean> } | null,
  search: { t?: string } = {}
) {
  let thrown: unknown
  try {
    beforeLoad({ context: { settings }, search })
  } catch (e) {
    thrown = e
  }
  expect(thrown).toBeInstanceOf(Response)
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  return (thrown as any).options as Record<string, unknown>
}

describe('/admin/tickets redirect', () => {
  it('opens the customer tickets view of the inbox', () => {
    const opts = redirectOf({ featureFlags: { supportTickets: true } })
    expect(opts.to).toBe('/admin/inbox')
    expect(opts.search).toEqual({ view: 'tickets_customer' })
    expect(opts.replace).toBe(true)
  })

  it('maps a ?t= ticket deep link onto the inbox selection', () => {
    const ticketId = generateId('ticket')
    const opts = redirectOf({ featureFlags: { supportTickets: true } }, { t: ticketId })
    expect(opts.to).toBe('/admin/inbox')
    expect(opts.search).toEqual({ i: ticketId })
    expect(opts.replace).toBe(true)
  })

  it('sends a workspace without tickets to the feedback page', () => {
    const opts = redirectOf(
      { featureFlags: { supportTickets: false } },
      { t: generateId('ticket') }
    )
    expect(opts.to).toBe('/admin/feedback')
  })

  it('treats missing settings as tickets off', () => {
    expect(redirectOf(null).to).toBe('/admin/feedback')
  })
})
