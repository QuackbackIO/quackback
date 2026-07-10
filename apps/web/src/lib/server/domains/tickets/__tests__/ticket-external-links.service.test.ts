/**
 * Real-DB coverage for the ticket external-link service: manual linking of a
 * ticket to an existing GitHub issue (by URL or owner/repo#number), unlink,
 * and the reverse-lookup list. Linking validates the active GitHub integration
 * and its configured repository, is idempotent, and records a team-only
 * 'external_linked' / 'external_unlinked' note. Runs inside the fixture
 * rollback.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type TicketId, type UserId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  tickets,
  ticketStatuses,
  ticketExternalLinks,
  settings,
  integrations,
  user,
  principal,
  eq,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

// Neutralize the fire-and-forget webhook bridge (createTicket emits ticket.created).
vi.mock('../ticket.webhooks', () => ({
  emitTicketCreated: vi.fn().mockResolvedValue(undefined),
  emitTicketStatusChanged: vi.fn().mockResolvedValue(undefined),
  emitTicketAssigned: vi.fn().mockResolvedValue(undefined),
}))

// Neutralize the real Redis-backed realtime publish; this suite doesn't
// exercise it.
vi.mock('@/lib/server/realtime/conversation-channels', () => ({ publishTicketEvent: vi.fn() }))

import { createTicket } from '../ticket.service'
import {
  parseGitHubIssueRef,
  linkTicketToIssue,
  unlinkTicketIssue,
  listTicketExternalLinks,
} from '../ticket-external-links.service'
import { listTicketMessages } from '../ticket-message.service'
import { resolveActorPermissions } from '@/lib/server/policy/permissions'
import type { Actor } from '@/lib/server/policy/types'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: tickets.id }).from(tickets).limit(0)
    await db.select({ id: ticketExternalLinks.id }).from(ticketExternalLinks).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedActor(role: 'admin' | 'user' = 'admin'): Promise<Actor> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `Agent-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role, type: 'user', createdAt: new Date() })
  return {
    principalId,
    role,
    principalType: 'user',
    segmentIds: new Set(),
    permissions: resolveActorPermissions(role),
  }
}

async function seedSettings(): Promise<void> {
  await testDb
    .insert(settings)
    .values({ name: 'Test WS', slug: `test_${suffix()}`, createdAt: new Date() })
}

async function seedDefaultStatus(): Promise<void> {
  await testDb
    .update(ticketStatuses)
    .set({ isDefault: false })
    .where(eq(ticketStatuses.isDefault, true))
  await testDb.insert(ticketStatuses).values({
    name: 'T-Open',
    slug: `t_open_${suffix()}`,
    category: 'open',
    position: 100,
    isDefault: true,
    publicStage: 'received',
  })
}

async function seedGitHubIntegration(config: Record<string, unknown> = {}) {
  const [row] = await testDb
    .insert(integrations)
    .values({
      integrationType: 'github',
      status: 'active',
      config: { channelId: 'acme/widgets', ...config },
    })
    .returning()
  return row
}

async function makeTicket(actor: Actor): Promise<TicketId> {
  const dto = await createTicket({ type: 'customer', title: `customer ${suffix()}` }, actor)
  return dto.id
}

describe('parseGitHubIssueRef', () => {
  it('parses a full issue URL', () => {
    expect(parseGitHubIssueRef('https://github.com/acme/widgets/issues/142')).toEqual({
      owner: 'acme',
      repo: 'widgets',
      number: 142,
    })
  })

  it('tolerates www, http, trailing slash, query, and hash', () => {
    for (const input of [
      'http://github.com/acme/widgets/issues/7',
      'https://www.github.com/acme/widgets/issues/7/',
      'https://github.com/acme/widgets/issues/7?foo=bar',
      'https://github.com/acme/widgets/issues/7#issuecomment-1',
    ]) {
      expect(parseGitHubIssueRef(input)).toEqual({ owner: 'acme', repo: 'widgets', number: 7 })
    }
  })

  it('parses the owner/repo#number shorthand', () => {
    expect(parseGitHubIssueRef('acme/widgets#9')).toEqual({
      owner: 'acme',
      repo: 'widgets',
      number: 9,
    })
    expect(parseGitHubIssueRef('  acme/widgets#9  ')).toEqual({
      owner: 'acme',
      repo: 'widgets',
      number: 9,
    })
  })

  it('handles dots and dashes in owner/repo names', () => {
    expect(parseGitHubIssueRef('my-org/my.repo-2#3')).toEqual({
      owner: 'my-org',
      repo: 'my.repo-2',
      number: 3,
    })
  })

  it('rejects everything else', () => {
    for (const input of [
      '',
      'not a ref',
      '#123',
      '123',
      'acme/widgets',
      'acme/widgets#',
      'acme/widgets#abc',
      'https://github.com/acme/widgets/pull/142',
      'https://gitlab.com/acme/widgets/issues/142',
      'https://github.com/acme/issues/142',
    ]) {
      expect(parseGitHubIssueRef(input)).toBeNull()
    }
  })
})

describe.skipIf(!fixture.available)('ticket-external-links.service (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('links a ticket to an existing issue and records a team-only note', async () => {
    await seedSettings()
    await seedDefaultStatus()
    const integration = await seedGitHubIntegration()
    const actor = await seedActor()
    const ticketId = await makeTicket(actor)

    const link = await linkTicketToIssue(
      ticketId,
      'https://github.com/acme/widgets/issues/142',
      actor
    )

    expect(link.integrationType).toBe('github')
    expect(link.externalId).toBe('142')
    expect(link.externalDisplayId).toBe('acme/widgets#142')
    expect(link.externalUrl).toBe('https://github.com/acme/widgets/issues/142')

    const rows = await testDb
      .select()
      .from(ticketExternalLinks)
      .where(eq(ticketExternalLinks.ticketId, ticketId))
    expect(rows).toHaveLength(1)
    expect(rows[0].integrationId).toBe(integration.id)
    expect(rows[0].externalId).toBe('142')
    expect(rows[0].status).toBe('active')

    // The audit note is internal (team-only) and carries the structured event.
    const page = await listTicketMessages(ticketId, { includeInternal: true })
    const event = page.messages.find((m) => m.systemEvent?.kind === 'external_linked')
    expect(event).toBeDefined()
    expect(event?.isInternal).toBe(true)
    expect(event?.systemEvent?.externalReference).toBe('acme/widgets#142')

    // ...and never leaks to the requester view.
    const requesterView = await listTicketMessages(ticketId, { includeInternal: false })
    expect(
      requesterView.messages.find((m) => m.systemEvent?.kind === 'external_linked')
    ).toBeUndefined()
  })

  it('accepts the owner/repo#number shorthand and derives the issue URL', async () => {
    await seedSettings()
    await seedDefaultStatus()
    await seedGitHubIntegration()
    const actor = await seedActor()
    const ticketId = await makeTicket(actor)

    const link = await linkTicketToIssue(ticketId, 'acme/widgets#9', actor)
    expect(link.externalId).toBe('9')
    expect(link.externalUrl).toBe('https://github.com/acme/widgets/issues/9')
  })

  it('is idempotent on a re-link of the same issue', async () => {
    await seedSettings()
    await seedDefaultStatus()
    await seedGitHubIntegration()
    const actor = await seedActor()
    const ticketId = await makeTicket(actor)

    const first = await linkTicketToIssue(ticketId, 'acme/widgets#5', actor)
    const second = await linkTicketToIssue(ticketId, 'https://github.com/acme/widgets/issues/5', actor)
    expect(second.id).toBe(first.id)

    const rows = await testDb
      .select()
      .from(ticketExternalLinks)
      .where(eq(ticketExternalLinks.ticketId, ticketId))
    expect(rows).toHaveLength(1)

    // No duplicate audit note either.
    const page = await listTicketMessages(ticketId, { includeInternal: true })
    expect(page.messages.filter((m) => m.systemEvent?.kind === 'external_linked')).toHaveLength(1)
  })

  it('rejects an invalid reference', async () => {
    await seedSettings()
    await seedDefaultStatus()
    await seedGitHubIntegration()
    const actor = await seedActor()
    const ticketId = await makeTicket(actor)

    await expect(linkTicketToIssue(ticketId, 'not an issue', actor)).rejects.toThrow(
      /issue url|owner\/repo/i
    )
  })

  it('rejects an issue from a repository other than the configured one', async () => {
    await seedSettings()
    await seedDefaultStatus()
    await seedGitHubIntegration({ channelId: 'acme/widgets' })
    const actor = await seedActor()
    const ticketId = await makeTicket(actor)

    await expect(linkTicketToIssue(ticketId, 'other/repo#3', actor)).rejects.toThrow(
      /connected repository/i
    )
  })

  it('rejects when no active GitHub integration exists', async () => {
    await seedSettings()
    await seedDefaultStatus()
    const actor = await seedActor()
    const ticketId = await makeTicket(actor)

    await expect(linkTicketToIssue(ticketId, 'acme/widgets#3', actor)).rejects.toThrow(/github/i)
  })

  it('requires the ticket.assign permission', async () => {
    await seedSettings()
    await seedDefaultStatus()
    await seedGitHubIntegration()
    const admin = await seedActor('admin')
    const ticketId = await makeTicket(admin)
    const outsider = await seedActor('user')

    await expect(linkTicketToIssue(ticketId, 'acme/widgets#3', outsider)).rejects.toThrow(
      /cannot/i
    )
    await expect(
      unlinkTicketIssue(ticketId, createId('ticket_external_link'), outsider)
    ).rejects.toThrow(/cannot/i)
  })

  it('unlinks and records a team-only note', async () => {
    await seedSettings()
    await seedDefaultStatus()
    await seedGitHubIntegration()
    const actor = await seedActor()
    const ticketId = await makeTicket(actor)

    const link = await linkTicketToIssue(ticketId, 'acme/widgets#11', actor)
    await unlinkTicketIssue(ticketId, link.id, actor)

    expect(await listTicketExternalLinks(ticketId)).toEqual([])
    const page = await listTicketMessages(ticketId, { includeInternal: true })
    const event = page.messages.find((m) => m.systemEvent?.kind === 'external_unlinked')
    expect(event).toBeDefined()
    expect(event?.systemEvent?.externalReference).toBe('acme/widgets#11')
  })

  it('unlink of an unknown link id is a no-op', async () => {
    await seedSettings()
    await seedDefaultStatus()
    await seedGitHubIntegration()
    const actor = await seedActor()
    const ticketId = await makeTicket(actor)

    await expect(
      unlinkTicketIssue(ticketId, createId('ticket_external_link'), actor)
    ).resolves.toBeUndefined()
  })

  it('lists a ticket\'s active links only', async () => {
    await seedSettings()
    await seedDefaultStatus()
    await seedGitHubIntegration()
    const actor = await seedActor()
    const ticketId = await makeTicket(actor)
    const other = await makeTicket(actor)

    await linkTicketToIssue(ticketId, 'acme/widgets#1', actor)
    await linkTicketToIssue(ticketId, 'acme/widgets#2', actor)
    await linkTicketToIssue(other, 'acme/widgets#3', actor)

    const links = await listTicketExternalLinks(ticketId)
    expect(links.map((l) => l.externalId).sort()).toEqual(['1', '2'])
  })
})
