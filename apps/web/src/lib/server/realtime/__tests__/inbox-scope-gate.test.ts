/**
 * The gate's reload sequencing, where a real database cannot time the race: a
 * scope change that lands while a reload is reading must be read again, or
 * the cache keeps the rows from before the change.
 */
import { describe, expect, it, vi } from 'vitest'
import type { PrincipalId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { createInboxScopeGate, type InboxScopeLoad } from '../inbox-scope-gate'

vi.mock('@/lib/server/logger', () => {
  const log: Record<string, unknown> = { debug() {}, info() {}, warn() {}, error() {} }
  log.child = () => log
  return { logger: log }
})

const ME = 'principal_me' as PrincipalId
const scoped = new Set([PERMISSIONS.TICKET_VIEW])

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const frame = (teamId: string) => ({
  message: JSON.stringify({ kind: 'ticket_read', teamId }),
  scope: { kind: 'ticket' as const, id: 't1', assigneePrincipalId: null, teamId },
})

describe('createInboxScopeGate', () => {
  it('reloads again when the scope changes while a reload is reading', async () => {
    const loads: Array<ReturnType<typeof deferred<InboxScopeLoad>>> = []
    const forwarded: string[] = []
    const gate = createInboxScopeGate({
      principalId: ME,
      initial: { permissions: scoped, teamIds: new Set() },
      load: () => {
        const d = deferred<InboxScopeLoad>()
        loads.push(d)
        return d.promise
      },
      runReload: (body) => body(),
      forward: (m) => forwarded.push(m),
      sendEvent: () => {},
      close: () => {},
    })

    gate.onScopeChanged()
    const f = frame('team_y')
    gate.onInboxFrame(f.message, f.scope)
    // A second change lands mid-read: the first read's rows may predate it.
    gate.onScopeChanged()
    loads[0].resolve({ permissions: scoped, teamIds: new Set() })
    await vi.waitFor(() => expect(loads).toHaveLength(2))
    expect(forwarded).toEqual([])

    loads[1].resolve({ permissions: scoped, teamIds: new Set(['team_y']) })
    await vi.waitFor(() => expect(forwarded).toEqual([f.message]))
  })
})
