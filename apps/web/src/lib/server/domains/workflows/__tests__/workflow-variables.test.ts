/**
 * Real-DB coverage for the workflow message-block variable resolver: it
 * reads a conversation's visitor principal (identified user vs. anonymous
 * visitor) plus the workspace's singleton settings row and builds the v1
 * catalogue (`first_name`, `name`, `email`, `workspace_name`). `settings` is
 * a strict singleton in this schema (one row per workspace), so tests update
 * the existing row's name rather than inserting a second one.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import { vi } from 'vitest'
import { createId, type PrincipalId, type UserId, type ConversationId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { conversations, principal, user, settings, eq } from '@/lib/server/db'
import { ANON_EMAIL_DOMAIN } from '@/lib/shared/anonymous-email'
import { NotFoundError } from '@/lib/shared/errors'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { resolveWorkflowVariables } from '../workflow-variables'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: conversations.id }).from(conversations).limit(0)
    await db.select({ id: settings.id }).from(settings).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedVisitor(opts: {
  type: 'user' | 'anonymous'
  name: string
  email?: string | null
  contactEmail?: string | null
}): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: opts.name, email: opts.email ?? null })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: opts.type === 'anonymous' ? 'user' : 'member',
    type: opts.type,
    displayName: opts.name || null,
    contactEmail: opts.contactEmail ?? null,
    createdAt: new Date(),
  })
  return principalId
}

async function seedConversation(visitorPrincipalId: PrincipalId): Promise<ConversationId> {
  const [conv] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId, channel: 'messenger' })
    .returning()
  return conv.id
}

/**
 * The workspace settings row is a singleton; point its name at a known
 * value. The test database may or may not carry a seeded row, so update the
 * existing one if present, otherwise insert one for the duration of the
 * (rolled-back) test transaction.
 */
async function setWorkspaceName(name: string): Promise<void> {
  const [row] = await testDb.select({ id: settings.id }).from(settings).limit(1)
  if (row) {
    await testDb.update(settings).set({ name }).where(eq(settings.id, row.id))
  } else {
    await testDb.insert(settings).values({ name, slug: `ws-${suffix()}`, createdAt: new Date() })
  }
}

describe.skipIf(!fixture.available)('resolveWorkflowVariables (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('resolves the full catalogue for an identified user with a full name', async () => {
    await setWorkspaceName('Acme Test Co')
    const principalId = await seedVisitor({
      type: 'user',
      name: 'Jane Doe',
      email: 'jane@example.com',
    })
    const conversationId = await seedConversation(principalId)

    const vars = await resolveWorkflowVariables(conversationId)
    expect(vars).toEqual({
      first_name: 'Jane',
      name: 'Jane Doe',
      email: 'jane@example.com',
      workspace_name: 'Acme Test Co',
    })
  })

  it('derives first_name as the whole name for a single-word name', async () => {
    await setWorkspaceName('Acme Test Co')
    const principalId = await seedVisitor({
      type: 'user',
      name: 'Madonna',
      email: 'madonna@example.com',
    })
    const conversationId = await seedConversation(principalId)

    const vars = await resolveWorkflowVariables(conversationId)
    expect(vars.first_name).toBe('Madonna')
    expect(vars.name).toBe('Madonna')
    expect(vars.email).toBe('madonna@example.com')
  })

  it('resolves an anonymous visitor with no name to empty first_name/name and strips the synthetic email', async () => {
    await setWorkspaceName('Acme Test Co')
    const principalId = await seedVisitor({
      type: 'anonymous',
      name: '',
      email: `temp-visitor-${suffix()}@${ANON_EMAIL_DOMAIN}`,
    })
    const conversationId = await seedConversation(principalId)

    const vars = await resolveWorkflowVariables(conversationId)
    // No fallback baked into the resolver output itself: interpolate() is
    // where a template-authored fallback like `{first_name|there}` applies.
    expect(vars.first_name).toBe('')
    expect(vars.name).toBe('')
    // The synthetic anon.quackback.io placeholder must never surface.
    expect(vars.email).toBe('')
    expect(vars.workspace_name).toBe('Acme Test Co')
  })

  it('prefers a real contactEmail over a missing user email for an anonymous visitor', async () => {
    await setWorkspaceName('Acme Test Co')
    const principalId = await seedVisitor({
      type: 'anonymous',
      name: '',
      email: `temp-visitor-${suffix()}@${ANON_EMAIL_DOMAIN}`,
      contactEmail: 'visitor-provided@example.com',
    })
    const conversationId = await seedConversation(principalId)

    const vars = await resolveWorkflowVariables(conversationId)
    expect(vars.email).toBe('visitor-provided@example.com')
  })

  it('throws NotFoundError for a conversation that does not exist', async () => {
    await expect(
      resolveWorkflowVariables(createId('conversation') as ConversationId)
    ).rejects.toThrow(NotFoundError)
  })
})
