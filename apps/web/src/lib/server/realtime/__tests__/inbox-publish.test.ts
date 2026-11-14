/**
 * The inbox publish: every frame on the shared inbox channel leaves with a
 * scope envelope, read by id when the caller did not pass one, and the frames
 * for one item leave in call order even when an earlier one waits on its read.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const publishAsync = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => {}))
vi.mock('../pubsub', () => ({ publishAsync }))

const logged = vi.hoisted(() => [] as Array<{ level: string; msg?: string }>)
vi.mock('@/lib/server/logger', () => {
  const record = (level: string) => (_obj: unknown, msg?: string) => logged.push({ level, msg })
  const log: Record<string, unknown> = {
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
  }
  log.child = () => log
  return { logger: log }
})

/** Self-reads answer from this table, keyed by id, after an optional gate. */
const rows = vi.hoisted(
  () => new Map<string, { assigneePrincipalId: string | null; teamId: string | null }>()
)
const gates = vi.hoisted(() => new Map<string, Promise<void>>())
const reads = vi.hoisted(() => [] as string[])
const failing = vi.hoisted(() => new Set<string>())
vi.mock('../inbox-scope-read', () => ({
  readInboxItemScope: vi.fn(async ({ id }: { id: string }) => {
    reads.push(id)
    await gates.get(id)
    if (failing.has(id)) throw new Error('read failed')
    return rows.get(id) ?? null
  }),
}))

import { publishInboxFrame, inboxPublishesSettled } from '../inbox-publish'

const INBOX = 'conversation:inbox'

beforeEach(() => {
  publishAsync.mockClear()
  rows.clear()
  gates.clear()
  failing.clear()
  reads.length = 0
  logged.length = 0
})

describe('publishInboxFrame', () => {
  it('sends the envelope the caller passed, without reading the row', async () => {
    publishInboxFrame(
      { kind: 'conversation', id: 'conversation_c1' },
      { kind: 'x' },
      {
        assigneePrincipalId: 'p1',
        teamId: 'ticket_t1',
      }
    )
    await inboxPublishesSettled()
    expect(reads).toEqual([])
    expect(publishAsync).toHaveBeenCalledWith(
      INBOX,
      { kind: 'x' },
      {
        kind: 'conversation',
        id: 'conversation_c1',
        assigneePrincipalId: 'p1',
        teamId: 'ticket_t1',
      }
    )
  })

  it('reads the owner and team by id when the caller passed none', async () => {
    rows.set('ticket_t9', { assigneePrincipalId: null, teamId: 'team_9' })
    publishInboxFrame({ kind: 'ticket', id: 'ticket_t9' }, { kind: 'ticket_read' })
    await inboxPublishesSettled()
    expect(reads).toEqual(['ticket_t9'])
    expect(publishAsync.mock.calls[0][2]).toEqual({
      kind: 'ticket',
      id: 'ticket_t9',
      assigneePrincipalId: null,
      teamId: 'team_9',
    })
  })

  it('carries both previous values when the writer passed them, even when null', async () => {
    publishInboxFrame(
      { kind: 'conversation', id: 'conversation_c1' },
      {},
      {
        assigneePrincipalId: 'p2',
        teamId: null,
        prev: { assigneePrincipalId: 'p1', teamId: null },
      }
    )
    await inboxPublishesSettled()
    expect(publishAsync.mock.calls[0][2]).toEqual({
      kind: 'conversation',
      id: 'conversation_c1',
      assigneePrincipalId: 'p2',
      teamId: null,
      prev: { assigneePrincipalId: 'p1', teamId: null },
    })
  })

  it('drops a frame whose row is gone, and one with no item, and logs both', async () => {
    publishInboxFrame({ kind: 'conversation', id: 'conversation_missing' }, {})
    publishInboxFrame(null, { kind: 'ticket_updated' })
    await inboxPublishesSettled()
    expect(publishAsync).not.toHaveBeenCalled()
    expect(logged.filter((l) => l.level === 'warn')).toHaveLength(2)
  })

  it('keeps call order for one item while an earlier frame waits on its read', async () => {
    let open!: () => void
    gates.set('conversation_c1', new Promise<void>((r) => (open = r)))
    rows.set('conversation_c1', { assigneePrincipalId: 'p1', teamId: null })
    publishInboxFrame({ kind: 'conversation', id: 'conversation_c1' }, { n: 1 })
    publishInboxFrame(
      { kind: 'conversation', id: 'conversation_c1' },
      { n: 2 },
      {
        assigneePrincipalId: 'p1',
        teamId: null,
      }
    )
    // Another item is not held behind this one.
    publishInboxFrame(
      { kind: 'conversation', id: 'conversation_c2' },
      { n: 3 },
      {
        assigneePrincipalId: null,
        teamId: null,
      }
    )
    await new Promise((r) => setTimeout(r, 10))
    expect(publishAsync.mock.calls.map((c) => c[1])).toEqual([{ n: 3 }])
    open()
    await inboxPublishesSettled()
    expect(publishAsync.mock.calls.map((c) => c[1])).toEqual([{ n: 3 }, { n: 1 }, { n: 2 }])
  })

  it('waits for the earlier publish itself, not only its read, before sending the next', async () => {
    let release!: () => void
    publishAsync.mockImplementationOnce(() => new Promise<void>((r) => (release = r)))
    const scope = { assigneePrincipalId: null, teamId: null }
    publishInboxFrame({ kind: 'ticket', id: 'ticket_t1' }, { n: 1 }, scope)
    publishInboxFrame({ kind: 'ticket', id: 'ticket_t1' }, { n: 2 }, scope)
    await new Promise((r) => setTimeout(r, 10))
    expect(publishAsync).toHaveBeenCalledTimes(1)
    release()
    await inboxPublishesSettled()
    expect(publishAsync.mock.calls.map((c) => c[1])).toEqual([{ n: 1 }, { n: 2 }])
  })

  it('a failed read or publish is logged and never blocks the next frame', async () => {
    failing.add('conversation_c1')
    publishInboxFrame({ kind: 'conversation', id: 'conversation_c1' }, { n: 1 })
    publishAsync.mockRejectedValueOnce(new Error('notify failed'))
    const scope = { assigneePrincipalId: null, teamId: null }
    publishInboxFrame({ kind: 'conversation', id: 'conversation_c1' }, { n: 2 }, scope)
    publishInboxFrame({ kind: 'conversation', id: 'conversation_c1' }, { n: 3 }, scope)
    await inboxPublishesSettled()
    expect(publishAsync.mock.calls.map((c) => c[1])).toEqual([{ n: 2 }, { n: 3 }])
    expect(logged.filter((l) => l.level === 'warn')).toHaveLength(2)
  })
})
