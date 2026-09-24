/**
 * The inbox route loader prefetches its nav/sidebar plumbing (nav-badge
 * counts, the company/ticket-type filter pickers, the team roster, the
 * attribute definitions the detail panel's editor and the standalone
 * create-ticket dialog both read unconditionally) so those reads ride the
 * document request instead of firing as separate client round trips that
 * each pay their own session/auth resolution. This pins the query keys the
 * loader is expected to warm, independent of any one server function's
 * actual DB work (the queryClient here never runs a real queryFn).
 */
import { describe, it, expect, vi } from 'vitest'
import { Route } from '../admin/inbox'

type LoaderFn = (ctx: {
  context: { settings: { featureFlags: Record<string, boolean> }; queryClient: unknown }
  location: { search: Record<string, unknown> }
}) => Promise<unknown>

const loader = (Route as unknown as { options: { loader: LoaderFn } }).options.loader

/** A queryClient stub that records every prefetched key without running the
 *  real queryFn (which would need a live server request + database). */
function fakeQueryClient() {
  const keys: string[] = []
  return {
    keys,
    ensureQueryData: vi.fn((opts: { queryKey: readonly unknown[] }) => {
      keys.push(JSON.stringify(opts.queryKey))
      return Promise.resolve(undefined)
    }),
  }
}

async function runLoader(
  featureFlags: Record<string, boolean>,
  search: Record<string, unknown> = {}
) {
  const queryClient = fakeQueryClient()
  await loader({
    context: { settings: { featureFlags }, queryClient },
    location: { search },
  })
  return queryClient.keys
}

describe('inbox route loader, nav/sidebar prefetch', () => {
  it('warms the nav-badge counts, company picker, team roster, and attribute definitions', async () => {
    const keys = await runLoader({ supportInbox: true, supportTickets: false })
    expect(keys).toContain(JSON.stringify(['admin', 'companies']))
    expect(keys).toContain(JSON.stringify(['admin', 'inbox', 'unified', 'counts']))
    expect(keys).toContain(JSON.stringify(['admin', 'inbox', 'teams']))
    expect(keys).toContain(JSON.stringify(['admin', 'conversation-attributes', 'live']))
  })

  it('warms the ticket status + type registry only when supportTickets is on', async () => {
    const off = await runLoader({ supportInbox: true, supportTickets: false })
    expect(off).not.toContain(JSON.stringify(['admin', 'tickets', 'statuses']))
    expect(off).not.toContain(JSON.stringify(['admin', 'tickets', 'types']))

    const on = await runLoader({ supportInbox: true, supportTickets: true })
    expect(on).toContain(JSON.stringify(['admin', 'tickets', 'statuses']))
    // The type registry is warmed unconditionally whenever tickets are on:
    // the standalone create-ticket dialog reads it regardless of the active
    // nav scope (it's mounted, just hidden, the whole time the page is).
    expect(on).toContain(JSON.stringify(['admin', 'tickets', 'types']))
  })

  it('does nothing when neither support flag is on (the component redirects instead)', async () => {
    const keys = await runLoader({ supportInbox: false, supportTickets: false })
    expect(keys).toEqual([])
  })
})
