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

// The create path decrypts integration secrets; supply a fixed token so
// seeded rows don't need real AES blobs.
vi.mock('@/lib/server/integrations/encryption', () => ({
  decryptSecrets: vi.fn(() => ({ accessToken: 'test-token' })),
}))

import { createTicket } from '../ticket.service'
import {
  linkTicketToIssue,
  unlinkTicketIssue,
  listTicketExternalLinks,
  createIssueForTicket,
} from '../ticket-external-links.service'
import { githubIssues } from '@/integrations/github/server/issues'
import { jiraIssues } from '@/integrations/jira/server/issues'
import { azureDevOpsIssues } from '@/integrations/azure-devops/server/issues'
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

describe('githubIssues.parseRef', () => {
  const parse = (input: string, config: Record<string, unknown> = {}) =>
    githubIssues.parseRef!(input, config)

  it('parses a full issue URL into the stored link fields', () => {
    expect(parse('https://github.com/acme/widgets/issues/142')).toEqual({
      externalId: '142',
      externalDisplayId: 'acme/widgets#142',
      externalUrl: 'https://github.com/acme/widgets/issues/142',
    })
  })

  it('tolerates www, http, trailing slash, query, and hash', () => {
    for (const input of [
      'http://github.com/acme/widgets/issues/7',
      'https://www.github.com/acme/widgets/issues/7/',
      'https://github.com/acme/widgets/issues/7?foo=bar',
      'https://github.com/acme/widgets/issues/7#issuecomment-1',
    ]) {
      expect(parse(input)?.externalId).toBe('7')
      expect(parse(input)?.externalDisplayId).toBe('acme/widgets#7')
    }
  })

  it('parses the owner/repo#number shorthand (dots/dashes tolerated, trimmed)', () => {
    expect(parse('  acme/widgets#9  ')?.externalUrl).toBe(
      'https://github.com/acme/widgets/issues/9'
    )
    expect(parse('my-org/my.repo-2#3')?.externalDisplayId).toBe('my-org/my.repo-2#3')
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
      expect(parse(input)).toBeNull()
    }
  })

  it('throws REPO_MISMATCH when the integration pins a different repository', () => {
    expect(() =>
      parse('https://github.com/other/repo/issues/1', { channelId: 'acme/widgets' })
    ).toThrowError(/connected repository/)
    // Same repo (case-insensitive) passes.
    expect(parse('ACME/Widgets#1', { channelId: 'acme/widgets' })?.externalId).toBe('1')
  })
})

describe('jiraIssues.parseRef', () => {
  const parse = (input: string, config: Record<string, unknown> = {}) =>
    jiraIssues.parseRef!(input, config)

  it('parses a browse URL, keeping the pasted URL and uppercasing the key', () => {
    expect(parse('https://acme.atlassian.net/browse/proj-42')).toEqual({
      externalId: 'PROJ-42',
      externalDisplayId: 'PROJ-42',
      externalUrl: 'https://acme.atlassian.net/browse/proj-42',
    })
  })

  it('parses the bare KEY-123 shorthand, deriving a URL from config.siteUrl when present', () => {
    expect(parse('PROJ-42')).toEqual({
      externalId: 'PROJ-42',
      externalDisplayId: 'PROJ-42',
      externalUrl: null,
    })
    expect(parse('proj-42', { siteUrl: 'https://acme.atlassian.net/' })?.externalUrl).toBe(
      'https://acme.atlassian.net/browse/PROJ-42'
    )
  })

  it('rejects non-refs', () => {
    for (const input of ['', 'PROJ', 'PROJ-', '42', 'https://acme.atlassian.net/browse/']) {
      expect(parse(input)).toBeNull()
    }
  })

  it('pins the connected site when configured (bare-key collision guard)', () => {
    expect(() =>
      parse('https://evil.atlassian.net/browse/PROJ-1', { siteUrl: 'https://acme.atlassian.net' })
    ).toThrowError(/connected jira site/i)
    expect(
      parse('https://acme.atlassian.net/browse/PROJ-1', {
        siteUrl: 'https://acme.atlassian.net',
      })?.externalId
    ).toBe('PROJ-1')
  })
})

describe('azureDevOpsIssues.parseRef', () => {
  const parse = (input: string, config: Record<string, unknown> = {}) =>
    azureDevOpsIssues.parseRef!(input, config)

  it('parses a work item URL (URL-only by design), dev.azure.com and legacy hosts', () => {
    expect(parse('https://dev.azure.com/acme/widgets/_workitems/edit/123')).toEqual({
      externalId: '123',
      externalDisplayId: '#123',
      externalUrl: 'https://dev.azure.com/acme/widgets/_workitems/edit/123',
    })
    expect(parse('https://acme.visualstudio.com/widgets/_workitems/edit/9')?.externalId).toBe('9')
  })

  it('rejects bare numbers, foreign hosts, and non-workitem URLs', () => {
    for (const input of [
      '123',
      '#123',
      'https://dev.azure.com/acme/widgets/_boards/board/1',
      'https://example.com/acme/widgets/_workitems/edit/123',
    ]) {
      expect(parse(input)).toBeNull()
    }
  })

  it('pins the connected organization when configured', () => {
    expect(() =>
      parse('https://dev.azure.com/evil/widgets/_workitems/edit/1', { organizationName: 'acme' })
    ).toThrowError(/connected organization/i)
    expect(
      parse('https://dev.azure.com/ACME/widgets/_workitems/edit/1', { organizationName: 'acme' })
        ?.externalId
    ).toBe('1')
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
    const second = await linkTicketToIssue(
      ticketId,
      'https://github.com/acme/widgets/issues/5',
      actor
    )
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

    await expect(linkTicketToIssue(ticketId, 'acme/widgets#3', outsider)).rejects.toThrow(/cannot/i)
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

  it('creates a GitHub issue from the ticket, links it, and notes "Created"', async () => {
    await seedSettings()
    await seedDefaultStatus()
    await seedGitHubIntegration({}) // channelId acme/widgets; secrets mocked
    await testDb
      .update(integrations)
      .set({ secrets: 'encrypted-blob' })
      .where(eq(integrations.integrationType, 'github'))
    const actor = await seedActor()
    const ticketId = await makeTicket(actor)
    // The requester's first message becomes the issue body narrative.
    const { conversationMessages } = await import('@/lib/server/db')
    await testDb.insert(conversationMessages).values({
      ticketId,
      principalId: actor.principalId,
      senderType: 'visitor',
      isInternal: false,
      content: 'It breaks when exporting large CSVs.',
    })

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ number: 77, html_url: 'https://github.com/acme/widgets/issues/77' }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        )
      )
    try {
      const link = await createIssueForTicket(ticketId, 'github', actor)

      expect(link.externalId).toBe('77')
      expect(link.externalDisplayId).toBe('acme/widgets#77')
      expect(link.externalUrl).toBe('https://github.com/acme/widgets/issues/77')

      // The API received the ticket title + first-message narrative + footer.
      const [url, init] = fetchSpy.mock.calls[0]
      expect(String(url)).toBe('https://api.github.com/repos/acme/widgets/issues')
      const sent = JSON.parse((init as RequestInit).body as string)
      expect(sent.body).toContain('It breaks when exporting large CSVs.')
      expect(sent.body).toContain('Created from Quackback ticket')

      const page = await listTicketMessages(ticketId, { includeInternal: true })
      const note = page.messages.find((m) => m.systemEvent?.kind === 'external_linked')
      expect(note?.content).toBe('Created GitHub issue acme/widgets#77')
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('reads the opening message from the linked conversation on a pair (convergence Phase 3 union)', async () => {
    await seedSettings()
    await seedDefaultStatus()
    await seedGitHubIntegration({})
    await testDb
      .update(integrations)
      .set({ secrets: 'encrypted-blob' })
      .where(eq(integrations.integrationType, 'github'))
    const actor = await seedActor()
    const ticketId = await makeTicket(actor)
    // CONVERGENCE: on a linked pair the opening message lands on the
    // CONVERSATION (the 1a/1b redirect) — a ticket-parent-only read would file
    // an empty narrative. Seed the pair + a conversation-parented report.
    const { conversations, ticketConversations, conversationMessages } =
      await import('@/lib/server/db')
    const conversationId = createId('conversation')
    await testDb.insert(conversations).values({
      id: conversationId,
      // Seeded actors always resolve a principal (seedActor inserts one).
      visitorPrincipalId: actor.principalId!,
      channel: 'web_form',
    })
    await testDb
      .insert(ticketConversations)
      .values({ ticketId, conversationId, ticketType: 'customer' })
    await testDb.insert(conversationMessages).values({
      conversationId,
      principalId: actor.principalId,
      senderType: 'visitor',
      isInternal: false,
      content: 'The opening report, filed on the shared thread.',
    })

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ number: 78, html_url: 'https://github.com/acme/widgets/issues/78' }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        )
      )
    try {
      const link = await createIssueForTicket(ticketId, 'github', actor)
      expect(link.externalId).toBe('78')
      const [, init] = fetchSpy.mock.calls[0]
      const sent = JSON.parse((init as RequestInit).body as string)
      expect(sent.body).toContain('The opening report, filed on the shared thread.')
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('never puts an internal note into the external issue body', async () => {
    await seedSettings()
    await seedDefaultStatus()
    await seedGitHubIntegration({})
    await testDb
      .update(integrations)
      .set({ secrets: 'encrypted-blob' })
      .where(eq(integrations.integrationType, 'github'))
    const actor = await seedActor()
    const ticketId = await makeTicket(actor)
    // Only an INTERNAL agent note exists — it must not leak to the tracker.
    const { conversationMessages } = await import('@/lib/server/db')
    await testDb.insert(conversationMessages).values({
      ticketId,
      principalId: actor.principalId,
      senderType: 'agent',
      isInternal: true,
      content: 'PRIVATE: customer is on the churn list, comp them a month.',
    })

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ number: 78, html_url: 'https://github.com/acme/widgets/issues/78' }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        )
      )
    try {
      await createIssueForTicket(ticketId, 'github', actor)
      const sent = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string) as {
        body: string
      }
      expect(sent.body).not.toContain('PRIVATE')
      expect(sent.body).toContain('Created from Quackback ticket')
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('jira create splits the composite channelId into project and issue type', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ key: 'PROJ-9' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    try {
      const ref = await jiraIssues.create!({
        auth: { channelId: '10000:10001', cloudId: 'cloud-1', accessToken: 'tok' },
        title: 'T',
        bodyMarkdown: 'B',
      })
      expect(ref.externalId).toBe('PROJ-9')
      const sent = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string) as {
        fields: { project: { id: string }; issuetype?: { id: string } }
      }
      expect(sent.fields.project.id).toBe('10000')
      expect(sent.fields.issuetype?.id).toBe('10001')
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('surfaces a create failure as a validation error and writes no link', async () => {
    await seedSettings()
    await seedDefaultStatus()
    await seedGitHubIntegration({})
    await testDb
      .update(integrations)
      .set({ secrets: 'encrypted-blob' })
      .where(eq(integrations.integrationType, 'github'))
    const actor = await seedActor()
    const ticketId = await makeTicket(actor)

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('nope', { status: 401 }))
    try {
      await expect(createIssueForTicket(ticketId, 'github', actor)).rejects.toThrow(
        /authentication failed/i
      )
      expect(await listTicketExternalLinks(ticketId)).toEqual([])
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('rejects creation for a provider without the create capability', async () => {
    await seedSettings()
    await seedDefaultStatus()
    const actor = await seedActor()
    const ticketId = await makeTicket(actor)

    // Shortcut has parseRef-less issues? No — it has neither capability today.
    await expect(createIssueForTicket(ticketId, 'shortcut', actor)).rejects.toThrow(
      /does not support/i
    )
  })

  it('links a Jira issue by key through the same generic path', async () => {
    await seedSettings()
    await seedDefaultStatus()
    await testDb.insert(integrations).values({
      integrationType: 'jira',
      status: 'active',
      config: { siteUrl: 'https://acme.atlassian.net' },
    })
    const actor = await seedActor()
    const ticketId = await makeTicket(actor)

    const link = await linkTicketToIssue(ticketId, 'proj-42', actor, 'jira')
    expect(link.integrationType).toBe('jira')
    expect(link.externalId).toBe('PROJ-42')
    expect(link.externalUrl).toBe('https://acme.atlassian.net/browse/PROJ-42')

    // The audit note names the provider, not GitHub.
    const page = await listTicketMessages(ticketId, { includeInternal: true })
    const event = page.messages.find((m) => m.systemEvent?.kind === 'external_linked')
    expect(event?.content).toContain('Jira issue PROJ-42')
  })

  it('rejects linking for a provider without the parseRef capability', async () => {
    await seedSettings()
    await seedDefaultStatus()
    await testDb
      .insert(integrations)
      .values({ integrationType: 'linear', status: 'active', config: {} })
    const actor = await seedActor()
    const ticketId = await makeTicket(actor)

    await expect(linkTicketToIssue(ticketId, 'ABC-123', actor, 'linear')).rejects.toThrow(
      /does not support/i
    )
  })

  it("lists a ticket's active links only", async () => {
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
