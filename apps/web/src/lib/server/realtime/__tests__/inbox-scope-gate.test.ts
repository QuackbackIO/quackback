/**
 * The gate's reload sequencing, where a real database cannot time the race: a
 * scope change that lands while a reload is reading must be read again, and a
 * reload that never answers must not hold frames forever.
 */
import { describe, expect, it, vi } from 'vitest'
import type { PrincipalId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { Actor } from '@/lib/server/policy/types'
import { createInboxScopeGate, type InboxScopeLoad } from '../inbox-scope-gate'

const logged = vi.hoisted(() => [] as string[])
vi.mock('@/lib/server/logger', () => {
  const log: Record<string, unknown> = {
    debug() {},
    info() {},
    warn: (_o: unknown, msg: string) => logged.push(msg),
    error() {},
  }
  log.child = () => log
  return { logger: log }
})

const scoped = new Set([PERMISSIONS.TICKET_VIEW])
const actor: Actor = {
  principalId: 'principal_me' as PrincipalId,
  role: 'member',
  principalType: 'user',
  segmentIds: new Set(),
  permissions: scoped,
}

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const frame = (teamId: string, n = 1) => ({
  message: JSON.stringify({ kind: 'ticket_read', n }),
  meta: { kind: 'ticket', id: 'ticket_1', assigneePrincipalId: null, teamId },
})

function gateWith(load: () => Promise<InboxScopeLoad>, reloadTimeoutMs?: number) {
  const forwarded: string[] = []
  const gate = createInboxScopeGate({
    actor,
    teamIds: new Set(),
    load,
    runReload: (body) => body(),
    forward: (m) => forwarded.push(m),
    sendEvent: () => {},
    close: () => {},
    reloadTimeoutMs,
  })
  return { gate, forwarded }
}

describe('createInboxScopeGate', () => {
  it('reloads again when the scope changes while a reload is reading', async () => {
    const loads: Array<ReturnType<typeof deferred<InboxScopeLoad>>> = []
    const { gate, forwarded } = gateWith(() => {
      const d = deferred<InboxScopeLoad>()
      loads.push(d)
      return d.promise
    })

    gate.onScopeChanged()
    const f = frame('team_y')
    gate.onInboxFrame(f.message, f.meta)
    // A second change lands mid-read: the first read's rows may predate it.
    gate.onScopeChanged()
    loads[0].resolve({ permissions: scoped, teamIds: new Set() })
    await vi.waitFor(() => expect(loads).toHaveLength(2))
    expect(forwarded).toEqual([])

    loads[1].resolve({ permissions: scoped, teamIds: new Set(['team_y']) })
    await vi.waitFor(() => expect(forwarded).toEqual([f.message]))
  })

  it('drops the frames behind a reload that never answers, and retries on the next frame', async () => {
    const loads: Array<ReturnType<typeof deferred<InboxScopeLoad>>> = []
    const { gate, forwarded } = gateWith(() => {
      const d = deferred<InboxScopeLoad>()
      loads.push(d)
      return d.promise
    }, 20)

    gate.onScopeChanged()
    const lost = frame('team_y', 1)
    gate.onInboxFrame(lost.message, lost.meta)
    await vi.waitFor(() => expect(logged.some((m) => /timed out/.test(m))).toBe(true))
    // The hung read answering late changes nothing: given a tick to act, it
    // still delivers none of the frames that were dropped.
    loads[0].resolve({ permissions: scoped, teamIds: new Set(['team_y']) })
    await new Promise((r) => setTimeout(r, 0))
    expect(forwarded).toEqual([])

    // The next frame is judged by a newer load, never by the late answer:
    // that one says team Y is in scope, the newer one says it is not.
    const next = frame('team_y', 2)
    gate.onInboxFrame(next.message, next.meta)
    expect(loads).toHaveLength(2)
    loads[1].resolve({ permissions: scoped, teamIds: new Set() })
    await new Promise((r) => setTimeout(r, 0))
    expect(forwarded).toEqual([])
  })
})
