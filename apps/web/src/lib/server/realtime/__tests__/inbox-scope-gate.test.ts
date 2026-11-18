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

  it('starts no second load while a timed-out load is still hung', async () => {
    const loads: Array<ReturnType<typeof deferred<InboxScopeLoad>>> = []
    const { gate, forwarded } = gateWith(() => {
      const d = deferred<InboxScopeLoad>()
      loads.push(d)
      return d.promise
    }, 20)

    gate.onScopeChanged()
    const lost = frame('team_y', 1)
    gate.onInboxFrame(lost.message, lost.meta)
    logged.length = 0
    await vi.waitFor(() => expect(logged.some((m) => /timed out/.test(m))).toBe(true))

    // The read is still out: the next frame waits on it rather than piling a
    // second read onto a database that is not answering.
    const next = frame('team_y', 2)
    gate.onInboxFrame(next.message, next.meta)
    await new Promise((r) => setTimeout(r, 0))
    expect(loads).toHaveLength(1)

    loads[0].resolve({ permissions: scoped, teamIds: new Set(['team_y']) })
    await vi.waitFor(() => expect(forwarded).toEqual([next.message]))
    expect(loads).toHaveLength(1)
  })

  it('tells the client to refetch once a reload succeeds after a failed one', async () => {
    const events: string[] = []
    let calls = 0
    const gate = createInboxScopeGate({
      actor,
      teamIds: new Set(),
      load: async () => {
        calls += 1
        if (calls === 1) throw new Error('database away')
        return { permissions: scoped, teamIds: new Set(['team_y']) }
      },
      runReload: (body) => body(),
      forward: () => {},
      sendEvent: (name) => events.push(name),
      close: () => {},
      startStale: true,
    })

    // The first reload fails: the frame waiting on it, and any removal it
    // carried, is lost.
    const lost = frame('team_y', 1)
    gate.onInboxFrame(lost.message, lost.meta)
    await vi.waitFor(() => expect(calls).toBe(1))
    await new Promise((r) => setTimeout(r, 0))
    expect(events).toEqual([])

    // The next reload works, and the client is told to catch up.
    const next = frame('team_y', 2)
    gate.onInboxFrame(next.message, next.meta)
    await vi.waitFor(() => expect(events).toEqual(['inbox_scope_changed']))

    // Once only: a later reload that works says nothing more.
    gate.onInboxFrame(next.message, next.meta)
    await new Promise((r) => setTimeout(r, 0))
    expect(events).toEqual(['inbox_scope_changed'])
  })

  it('never judges by a load that started before the latest scope change', async () => {
    const loads: Array<ReturnType<typeof deferred<InboxScopeLoad>>> = []
    const forwarded: string[] = []
    const gate = createInboxScopeGate({
      actor,
      teamIds: new Set(),
      load: () => {
        const d = deferred<InboxScopeLoad>()
        loads.push(d)
        return d.promise
      },
      runReload: (body) => body(),
      forward: (m) => forwarded.push(m),
      sendEvent: () => {},
      close: () => {},
      startStale: true,
      reloadTimeoutMs: 20,
    })

    // A load starts while the teammate is still on team Y, then times out.
    const first = frame('team_y', 1)
    gate.onInboxFrame(first.message, first.meta)
    logged.length = 0
    await vi.waitFor(() => expect(logged.some((m) => /timed out/.test(m))).toBe(true))
    // They leave team Y while that load is still out; the reload it starts
    // waits on the hung load.
    gate.onScopeChanged()
    await new Promise((r) => setTimeout(r, 0))
    expect(loads).toHaveLength(1)

    // The old load answers with the scope from before the change.
    loads[0].resolve({ permissions: scoped, teamIds: new Set(['team_y']) })
    await new Promise((r) => setTimeout(r, 0))
    const after = frame('team_y', 2)
    gate.onInboxFrame(after.message, after.meta)
    await new Promise((r) => setTimeout(r, 0))
    expect(forwarded).toEqual([])

    // A fresh read decides, and it says team Y is gone.
    await vi.waitFor(() => expect(loads).toHaveLength(2))
    loads[1].resolve({ permissions: scoped, teamIds: new Set() })
    await new Promise((r) => setTimeout(r, 0))
    expect(forwarded).toEqual([])
  })

  describe('a reload that keeps failing closes the stream, so the client reconnects', () => {
    function gateCounting(load: () => Promise<InboxScopeLoad>) {
      const closed = vi.fn()
      const gate = createInboxScopeGate({
        actor,
        teamIds: new Set(),
        load,
        runReload: (body) => body(),
        forward: () => {},
        sendEvent: () => {},
        close: closed,
        startStale: true,
        reloadTimeoutMs: 10,
      })
      return { gate, closed }
    }
    const settleFrame = async (gate: ReturnType<typeof gateCounting>['gate'], n: number) => {
      const f = frame('team_y', n)
      gate.onInboxFrame(f.message, f.meta)
      await new Promise((r) => setTimeout(r, 30))
    }

    it('closes after three reloads in a row against a load that never answers', async () => {
      const { gate, closed } = gateCounting(() => new Promise<InboxScopeLoad>(() => {}))
      await settleFrame(gate, 1)
      await settleFrame(gate, 2)
      expect(closed).not.toHaveBeenCalled()
      await settleFrame(gate, 3)
      expect(closed).toHaveBeenCalledTimes(1)
    })

    it('counts only failures in a row: a reload that works starts the count again', async () => {
      const answers = ['fail', 'fail', 'ok', 'fail', 'fail']
      const { gate, closed } = gateCounting(async () => {
        if (answers.shift() === 'fail') throw new Error('database away')
        return { permissions: scoped, teamIds: new Set() }
      })
      for (let n = 1; n <= 3; n++) await settleFrame(gate, n)
      // The working reload set no expiry problem: force the next ones stale.
      gate.onScopeChanged()
      await new Promise((r) => setTimeout(r, 30))
      await settleFrame(gate, 4)
      expect(closed).not.toHaveBeenCalled()
    })
  })
})
