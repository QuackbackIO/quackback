/**
 * Real-Postgres coverage for the copilot's closed-tickets knowledge source
 * following the asking teammate's ticket scope (`ticketFilter`).
 *
 * World: a scoped teammate on team X (ticket.view only), a workspace-wide
 * teammate (ticket.view_all), and one closed-ticket summary per team. Both
 * retrieval paths are covered: keyword (no embedding) and semantic (a fixed
 * query vector against seeded embeddings). The tool-seam case runs the
 * `search` tool with Quinn's default service actor plus the teammate as
 * viewer, the shape a copilot turn builds.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type TypeId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  principal,
  sql,
  teamMembers,
  teams,
  tickets,
  ticketStatuses,
  ticketSummaries,
  user,
} from '@/lib/server/db'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { Actor } from '@/lib/server/policy/types'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

let queryEmbedding: number[] | null = null
vi.mock('@/lib/server/domains/embeddings/embedding.service', () => ({
  generateEmbedding: async () => queryEmbedding,
}))

import { retrieveTicketSummaries } from '../tickets-retrieval'
import { ASSISTANT_TOOL_SPECS, makeAssistantToolContext } from '../assistant.toolspec'
import { quinnActor } from '../assistant.actor'

type TicketId = TypeId<'ticket'>

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: ticketSummaries.id }).from(ticketSummaries).limit(0)
    await db.select({ id: teamMembers.id }).from(teamMembers).limit(0)
  },
})

/** A unit vector along one axis: the query and both summaries share it, so
 *  the semantic path scores every seeded row at cosine 1. */
const VECTOR = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0))

let query: string
let scoped: Actor
let viewAll: Actor
let teamXTicket: TicketId
let teamYTicket: TicketId

async function seedTeammate(): Promise<PrincipalId> {
  const userId = createId('user')
  const principalId = createId('principal')
  await testDb.insert(user).values({ id: userId, name: 'Teammate', email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })
  return principalId
}

function memberActor(principalId: PrincipalId, permissions: string[]): Actor {
  return {
    principalId,
    principalType: 'user',
    role: 'member',
    segmentIds: new Set(),
    permissions: new Set(permissions) as Actor['permissions'],
  }
}

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  queryEmbedding = null
  query = `sso${createId('user').replace(/[^a-z0-9]/g, '')}`

  const scopedId = await seedTeammate()
  const viewAllId = await seedTeammate()
  scoped = memberActor(scopedId, [PERMISSIONS.TICKET_VIEW])
  viewAll = memberActor(viewAllId, [PERMISSIONS.TICKET_VIEW, PERMISSIONS.TICKET_VIEW_ALL])

  const teamX = createId('team')
  const teamY = createId('team')
  await testDb.insert(teams).values([
    { id: teamX, name: `X-${teamX}` },
    { id: teamY, name: `Y-${teamY}` },
  ])
  await testDb.insert(teamMembers).values({ teamId: teamX, principalId: scopedId })

  const statusId = createId('ticket_status')
  await testDb
    .insert(ticketStatuses)
    .values({ id: statusId, name: 'Closed', slug: `closed-${statusId}`, category: 'closed' })
  teamXTicket = createId('ticket') as TicketId
  teamYTicket = createId('ticket') as TicketId
  await testDb.insert(tickets).values([
    { id: teamXTicket, title: 'team X', statusId, assigneeTeamId: teamX },
    { id: teamYTicket, title: 'team Y', statusId, assigneeTeamId: teamY },
  ])
  const summary = (ticketId: TicketId, who: string) => ({
    ticketId,
    summary: `${query} login broke for ${who}; fixed by re-adding the callback URL.`,
    embedding: sql`${`[${VECTOR.join(',')}]`}::vector`,
    embeddingModel: 'test',
  })
  await testDb
    .insert(ticketSummaries)
    .values([summary(teamXTicket, 'team X'), summary(teamYTicket, 'team Y')])
})
afterEach(() => fixture.rollback())
afterAll(() => fixture.close())

async function ids(viewer: Actor | undefined): Promise<string[]> {
  const rows = await retrieveTicketSummaries(query, 'team', { viewer })
  return rows.map((row) => row.ticketId).sort()
}

describe.each([
  ['keyword', null],
  ['semantic', VECTOR],
])('closed-ticket summaries follow the viewer scope (%s path)', (_path, embedding) => {
  beforeEach(() => {
    queryEmbedding = embedding
  })

  it("gives a scoped teammate their own team's summary and not another team's", async () => {
    expect(await ids(scoped)).toEqual([teamXTicket])
  })

  it('gives a workspace-wide teammate every summary', async () => {
    expect(await ids(viewAll)).toEqual([teamXTicket, teamYTicket].sort())
  })

  it("never widens to Quinn's own service actor or a missing viewer", async () => {
    expect(await ids(quinnActor(scoped.principalId!))).toEqual([])
    expect(await ids(undefined)).toEqual([])
  })
})

it('drops the summary of a soft-deleted ticket', async () => {
  const { eq } = await import('@/lib/server/db')
  await testDb.update(tickets).set({ deletedAt: new Date() }).where(eq(tickets.id, teamXTicket))
  expect(await ids(viewAll)).toEqual([teamYTicket])
})

describe('search tool on a copilot turn', () => {
  it("scopes ticket results to the asking teammate, not Quinn's actor", async () => {
    const assistantPrincipalId = await seedTeammate()
    const ctx = makeAssistantToolContext({
      db: testDb,
      assistantPrincipalId,
      role: 'copilot_qa',
      audience: 'team',
      conversationId: null,
      viewer: scoped,
      knowledge: { sources: new Set(['ticket']), status: false },
    })
    // The executing actor stays Quinn's bounded service actor.
    expect(ctx.actor.principalType).toBe('service')

    const out = (await ASSISTANT_TOOL_SPECS.search.execute({ query }, ctx)) as {
      results: { id: string; kind: string }[]
    }

    expect(out.results.map((r) => r.id)).toEqual([teamXTicket])
    expect(ctx.ledger.sources.has(teamYTicket)).toBe(false)
  })
})
