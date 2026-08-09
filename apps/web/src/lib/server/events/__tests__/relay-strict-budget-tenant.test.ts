/**
 * The relay's strict-resolution retry budget, across tenants.
 *
 * §4.2 records `events/relay.ts` as holding "`strictAttempts` keyed by a bare
 * per-tenant bigint". `events.id` is a per-database bigserial, so two
 * workspaces both have an event 5 and they are not the same row.
 *
 * The budget exists so a deterministically-failing sink is retried ten times
 * before the relay degrades to best-effort resolution and **drops that sink's
 * targets**. Keyed by the bare id, one workspace's ten failures spend another
 * workspace's budget: its next event arrives with the counter already at the
 * ceiling and its targets are dropped on the first attempt, without ever having
 * failed once.
 *
 * ## What is observed, and why it is the real signal
 *
 * `drainOnce` is called with NO injected resolver, so the registry path runs
 * and the strict/best-effort distinction is live (with an injected resolver the
 * relay always runs strict, and the whole property would be unobservable).
 * A registered resolver that always throws then separates the two modes
 * cleanly:
 *
 * - strict     → `resolveTargets` rejects → row left unpublished, `failed = 1`
 * - degraded   → `resolveTargets(bestEffort)` swallows it → row published
 *
 * So "was this event's budget already spent" is read off `published_at`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

interface Row {
  id: bigint
  eventId: string
  type: string
  entityType: string
  entityId: string
  actorType: string
  actorId: string | null
  payload: unknown
  context: { depth: number }
  schemaVersion: number
  occurredAt: Date
  publishedAt: Date | null
}

const hoisted = vi.hoisted(() => ({
  /** tenantId -> that tenant's `events` table. Two databases, as in production. */
  tables: new Map<string, Row[]>(),
  currentTenantId: (): string => '',
}))

function table(): Row[] {
  const id = hoisted.currentTenantId()
  let t = hoisted.tables.get(id)
  if (!t) {
    t = []
    hoisted.tables.set(id, t)
  }
  return t
}

vi.mock('@/lib/server/db', () => {
  const unpublished = () =>
    table()
      .filter((r) => r.publishedAt === null)
      .sort((a, b) => (a.id < b.id ? -1 : 1))
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({ limit: async (n: number) => unpublished().slice(0, n) }),
          }),
        }),
      }),
      update: () => ({
        set: (values: { publishedAt: Date }) => ({
          where: async (predicate: { id: bigint }) => {
            const row = table().find((r) => r.id === predicate.id)
            if (row) row.publishedAt = values.publishedAt
          },
        }),
      }),
    },
    events: { id: 'id', publishedAt: 'published_at' },
    // `eq(events.id, id)` is the only predicate the relay builds for a write.
    eq: (_col: unknown, id: bigint) => ({ id }),
    isNull: () => null,
    asc: () => null,
  }
})

vi.mock('@/lib/server/queue/role', () => ({ shouldRunWorkers: () => true }))
vi.mock('../process', () => ({ enqueueHookJobsWithIds: async () => undefined }))

const { drainOnce } = await import('../relay')
const { registerResolver, __resetResolversForTests } = await import('../resolvers/registry')
const { withTenant } = await import('@/lib/server/__tests__/tenant-scope')
const { getCurrentTenant } = await import('@/lib/server/tenancy/tenant-context')

hoisted.currentTenantId = () => getCurrentTenant()?.tenantId ?? ''

/**
 * Both workspaces get an event whose id is the same bigint, and every case gets
 * an id no other case in this file has used.
 *
 * The retry ledger is module-scope and survives `beforeEach` by design — that
 * is the thing under test. A shared id across cases would let a counter left by
 * an earlier case supply the degradation a later one is trying to cause, which
 * is how the first version of this file passed a step it should have failed.
 */
let idCounter = 0n
function freshId(): bigint {
  idCounter += 1n
  return 5n + idCounter * 100n
}

function seed(tenantId: string, id: bigint): void {
  hoisted.tables.set(tenantId, [
    {
      id,
      eventId: `evt_${tenantId}_${id}`,
      type: 'post.created',
      entityType: 'post',
      entityId: 'post_1',
      actorType: 'user',
      actorId: null,
      payload: {},
      context: { depth: 0 },
      schemaVersion: 1,
      occurredAt: new Date(),
      publishedAt: null,
    },
  ])
}

function published(tenantId: string, id: bigint): boolean {
  return hoisted.tables.get(tenantId)?.find((r) => r.id === id)?.publishedAt !== null
}

beforeEach(() => {
  hoisted.tables.clear()
  __resetResolversForTests()
  registerResolver({
    sink: 'always-failing',
    interestedIn: () => true,
    resolve: async () => {
      throw new Error('deterministic sink failure')
    },
  })
})

describe('the fixture reaches the branch', () => {
  it('a strict pass leaves the row unpublished and counts a failure', async () => {
    const id = freshId()
    seed('tenant-alpha', id)
    const res = await withTenant('tenant-alpha', () => drainOnce({ maxStrictResolveAttempts: 3 }))

    expect(res.failed).toBe(1)
    expect(published('tenant-alpha', id)).toBe(false)
  })

  it('the budget really does run out — the row publishes once it is spent', async () => {
    // Without this the isolation assertion below would be a negative that holds
    // because degradation never happens at all.
    const id = freshId()
    seed('tenant-alpha', id)
    for (let i = 0; i < 3; i++) {
      await withTenant('tenant-alpha', () => drainOnce({ maxStrictResolveAttempts: 3 }))
      expect(published('tenant-alpha', id), `pass ${i + 1} should still be strict`).toBe(false)
    }
    await withTenant('tenant-alpha', () => drainOnce({ maxStrictResolveAttempts: 3 }))

    expect(published('tenant-alpha', id)).toBe(true)
  })
})

describe('one workspace cannot spend another workspace’s retry budget', () => {
  it('bravo’s event 5 is still strict after alpha’s event 5 exhausted its budget', async () => {
    const id = freshId()
    seed('tenant-alpha', id)
    for (let i = 0; i < 4; i++) {
      await withTenant('tenant-alpha', () => drainOnce({ maxStrictResolveAttempts: 3 }))
    }
    expect(published('tenant-alpha', id)).toBe(true)

    seed('tenant-bravo', id)
    const res = await withTenant('tenant-bravo', () => drainOnce({ maxStrictResolveAttempts: 3 }))

    expect(res.failed).toBe(1)
    expect(published('tenant-bravo', id)).toBe(false)
  })

  it('holds in the other order too', async () => {
    const id = freshId()
    seed('tenant-bravo', id)
    for (let i = 0; i < 4; i++) {
      await withTenant('tenant-bravo', () => drainOnce({ maxStrictResolveAttempts: 3 }))
    }
    expect(published('tenant-bravo', id)).toBe(true)

    seed('tenant-alpha', id)
    await withTenant('tenant-alpha', () => drainOnce({ maxStrictResolveAttempts: 3 }))

    expect(published('tenant-alpha', id)).toBe(false)
  })

  it('an empty outbox in one workspace does not reset another’s counters', async () => {
    // `drainOnce` clears the ledger when it finds nothing to drain. Fleet-wide
    // that would hand every workspace its budget back because one happened to
    // be idle — and a deterministically-failing sink would then never degrade.
    const id = freshId()
    seed('tenant-alpha', id)
    for (let i = 0; i < 3; i++) {
      await withTenant('tenant-alpha', () => drainOnce({ maxStrictResolveAttempts: 3 }))
    }
    expect(published('tenant-alpha', id), 'alpha must still be un-degraded here').toBe(false)

    hoisted.tables.set('tenant-bravo', [])
    await withTenant('tenant-bravo', () => drainOnce({ maxStrictResolveAttempts: 3 }))

    await withTenant('tenant-alpha', () => drainOnce({ maxStrictResolveAttempts: 3 }))
    expect(published('tenant-alpha', id)).toBe(true)
  })

  it('a neighbour draining a different id range does not reset this one’s counters', async () => {
    // Named for what it actually pins. An earlier version of this case was
    // titled "prunes only the active workspace's spent counters" and asserted
    // the same thing — but a broken prune leaves counters ALONE, so the
    // assertion held either way. It pins `clearTenant`, not the prune; the
    // prune has its own case below.
    const id = freshId()
    seed('tenant-alpha', id)
    for (let i = 0; i < 3; i++) {
      await withTenant('tenant-alpha', () => drainOnce({ maxStrictResolveAttempts: 3 }))
    }
    expect(published('tenant-alpha', id), 'alpha must still be un-degraded here').toBe(false)

    seed('tenant-bravo', id + 999_999n)
    await withTenant('tenant-bravo', () => drainOnce({ maxStrictResolveAttempts: 3 }))

    await withTenant('tenant-alpha', () => drainOnce({ maxStrictResolveAttempts: 3 }))
    expect(published('tenant-alpha', id)).toBe(true)
  })

  it('prunes counters for rows the leader has moved past', async () => {
    // The prune's only effect is on memory, which is why the case above could
    // not see it. It becomes observable when an id is REUSED: a leader change
    // abandons row N unpublished, the outbox moves on to a higher id, and a
    // later row arrives carrying N again. With the prune, N starts from a clean
    // budget; without it, N inherits the abandoned count and can degrade —
    // dropping a healthy sink's targets on its first real attempt.
    const low = freshId()
    const high = low + 500n

    seed('tenant-alpha', low)
    for (let i = 0; i < 2; i++) {
      await withTenant('tenant-alpha', () => drainOnce({ maxStrictResolveAttempts: 3 }))
    }
    // Precondition: the ledger really is carrying attempts for `low`.
    expect(published('tenant-alpha', low), 'low must be unpublished with attempts banked').toBe(
      false
    )

    // The leader moves past it: `low` is gone, `high` is the smallest unpublished id.
    seed('tenant-alpha', high)
    await withTenant('tenant-alpha', () => drainOnce({ maxStrictResolveAttempts: 3 }))

    // `low` comes back. Two more strict passes must NOT be enough to degrade it.
    hoisted.tables.set('tenant-alpha', [])
    seed('tenant-alpha', low)
    for (let i = 0; i < 2; i++) {
      await withTenant('tenant-alpha', () => drainOnce({ maxStrictResolveAttempts: 3 }))
    }

    expect(published('tenant-alpha', low)).toBe(false)
  })
})
