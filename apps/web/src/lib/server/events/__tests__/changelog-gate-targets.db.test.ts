/**
 * A changelog publish is announced (email and bell) only to subscribers who
 * could read the entry on the changelog itself: the entry's labels must let
 * them in (a segment-gated label keeps out non-members), the changelog
 * audience must allow them, the portal must let them in, and the Changelog
 * product must be on.
 *
 * Runs the real target resolver against the real database inside the test-DB
 * fixture's rolled-back transaction. Settings and the peripheral services are
 * mocked, as in status-subscriber-targets.db.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const workspace = vi.hoisted(() => ({
  changelog: true,
  audience: 'public' as 'public' | 'authenticated',
  portal: { access: { visibility: 'public' } } as Record<string, unknown>,
}))
const settingsReads = vi.hoisted(() => ({ count: 0 }))
vi.mock('@/lib/server/domains/settings/settings.changelog', () => ({
  getChangelogSettings: async () => {
    settingsReads.count++
    return {
      audience: workspace.audience,
      showInNav: true,
      allowComments: true,
      autoSubscribe: false,
      emailsDisabled: false,
    }
  },
}))
vi.mock('@/lib/server/domains/settings/settings.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/settings/settings.service')>()),
  isFeatureEnabled: async (flag: string) => (flag === 'changelog' ? workspace.changelog : true),
  getPortalConfig: async () => workspace.portal,
}))
vi.mock('@/lib/server/domains/subscriptions/subscription.service', () => ({
  getSubscribersForEvent: vi.fn().mockResolvedValue([]),
  batchGetNotificationPreferences: vi.fn().mockResolvedValue(new Map()),
  batchGenerateChangelogUnsubscribeTokens: vi
    .fn()
    .mockImplementation(async (ids: string[]) => new Map(ids.map((id) => [id, `tok-${id}`]))),
  batchGenerateUnsubscribeTokens: vi.fn().mockResolvedValue(new Map()),
}))

import {
  changelogCategories,
  changelogEntries,
  changelogEntryCategories,
  changelogSubscriptions,
  principal,
  segments,
  user,
  userSegments,
} from '@/lib/server/db'
import {
  createId,
  type ChangelogCategoryId,
  type ChangelogId,
  type PrincipalId,
  type SegmentId,
} from '@quackback/ids'
import { getChangelogSubscriberTargets } from '../targets'
import type { EventData } from '../types'
import type { HookContext } from '../hook-context'

const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const SEGMENT = createId('segment') as SegmentId
const LABEL = createId('changelog_category') as ChangelogCategoryId
const P_MEMBER = createId('principal') as PrincipalId
const P_OUTSIDER = createId('principal') as PrincipalId
const P_ANON = createId('principal') as PrincipalId
const P_AUTHOR = createId('principal') as PrincipalId
const OPEN = createId('changelog') as ChangelogId
const GATED = createId('changelog') as ChangelogId
const MEMBER_EMAIL = `chg-gate-member-${run}@example.com`
const OUTSIDER_EMAIL = `chg-gate-outsider-${run}@example.com`
const ANON_EMAIL = `chg-gate-anon-${run}@example.com`

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: changelogSubscriptions.id }).from(changelogSubscriptions).limit(0)
  },
})

const context: HookContext = {
  workspaceName: 'Changelog Gate Test',
  portalBaseUrl: 'https://portal.example.com',
  logoUrl: null,
}

function published(id: ChangelogId): EventData {
  return {
    type: 'changelog.published',
    actor: { type: 'user', principalId: P_AUTHOR, displayName: 'Author' },
    data: {
      changelog: {
        id,
        title: 'Release',
        contentPreview: 'preview',
        contentHtml: '<p>preview</p>',
        publishedAt: new Date().toISOString(),
        linkedPostCount: 0,
      },
    },
  } as EventData
}

/** Who is emailed and who is belled, among this file's subscribers. */
async function announced(id: ChangelogId) {
  const targets = await getChangelogSubscriberTargets(published(id), context)
  const mine = new Set<string>([MEMBER_EMAIL, OUTSIDER_EMAIL, ANON_EMAIL])
  const emailed = targets
    .filter((t) => t.type === 'email')
    .map((t) => (t.target as { email: string }).email)
    .filter((e) => mine.has(e))
    .sort()
  const ours = new Set<string>([P_MEMBER, P_OUTSIDER, P_ANON])
  const belled = targets
    .filter((t) => t.type === 'notification')
    .flatMap((t) => (t.target as { principalIds: string[] }).principalIds)
    .filter((id) => ours.has(id))
    .sort()
  return { emailed, belled }
}

describe.skipIf(!fixture.available)('changelog announcements respect the changelog gates', () => {
  beforeEach(async () => {
    await fixture.begin()
    await testDb.insert(segments).values({ id: SEGMENT, name: `cg-${run}`, slug: `cg-${run}` })
    const [memberUser, outsiderUser, anonUser, authorUser] = [
      createId('user'),
      createId('user'),
      createId('user'),
      createId('user'),
    ]
    await testDb.insert(user).values([
      { id: memberUser, name: 'Member', email: MEMBER_EMAIL, emailVerified: true },
      { id: outsiderUser, name: 'Outsider', email: OUTSIDER_EMAIL, emailVerified: true },
      { id: anonUser, name: 'Anon', email: ANON_EMAIL },
      { id: authorUser, name: 'Author', email: `chg-gate-author-${run}@example.com` },
    ])
    await testDb.insert(principal).values([
      { id: P_MEMBER, userId: memberUser, role: 'user', createdAt: new Date() },
      { id: P_OUTSIDER, userId: outsiderUser, role: 'user', createdAt: new Date() },
      { id: P_ANON, userId: anonUser, role: 'user', type: 'anonymous', createdAt: new Date() },
      { id: P_AUTHOR, userId: authorUser, role: 'admin', createdAt: new Date() },
    ])
    await testDb
      .insert(userSegments)
      .values({ principalId: P_MEMBER, segmentId: SEGMENT, addedBy: 'manual' })
    await testDb
      .insert(changelogCategories)
      .values({ id: LABEL, name: `vip-${run}`, color: '#000000', segmentIds: [SEGMENT] })
    const now = new Date()
    await testDb.insert(changelogEntries).values([
      { id: OPEN, title: `open-${run}`, content: 'open', publishedAt: now },
      { id: GATED, title: `gated-${run}`, content: 'gated', publishedAt: now },
    ])
    await testDb
      .insert(changelogEntryCategories)
      .values({ changelogEntryId: GATED, categoryId: LABEL })
    await testDb.insert(changelogSubscriptions).values([
      { principalId: P_MEMBER, source: 'admin' },
      { principalId: P_OUTSIDER, source: 'admin' },
      { principalId: P_ANON, source: 'admin' },
    ])
  })
  afterEach(async () => {
    workspace.changelog = true
    workspace.audience = 'public'
    workspace.portal = { access: { visibility: 'public' } }
    await fixture.rollback()
  })
  afterAll(fixture.close)

  it('announces an entry without gated labels to every subscriber', async () => {
    expect(await announced(OPEN)).toEqual({
      emailed: [ANON_EMAIL, MEMBER_EMAIL, OUTSIDER_EMAIL].sort(),
      belled: [P_ANON, P_MEMBER, P_OUTSIDER].sort(),
    })
  })

  it('announces an entry with a segment-gated label only to members of the segment', async () => {
    expect(await announced(GATED)).toEqual({ emailed: [MEMBER_EMAIL], belled: [P_MEMBER] })
  })

  it('leaves out anonymous subscribers when the changelog is for signed-in people', async () => {
    workspace.audience = 'authenticated'
    expect(await announced(OPEN)).toEqual({
      emailed: [MEMBER_EMAIL, OUTSIDER_EMAIL].sort(),
      belled: [P_MEMBER, P_OUTSIDER].sort(),
    })
  })

  it('reads the changelog settings once per announcement, not once per recipient', async () => {
    workspace.audience = 'authenticated'
    settingsReads.count = 0
    await announced(GATED)
    // One read for the reader filter, one for the email kill switch.
    expect(settingsReads.count).toBeLessThanOrEqual(2)
  })

  it('on a private portal, announces only to subscribers the portal lets in', async () => {
    workspace.portal = {
      access: { visibility: 'private', allowedDomains: [], allowedSegmentIds: [SEGMENT] },
    }
    expect(await announced(OPEN)).toEqual({ emailed: [MEMBER_EMAIL], belled: [P_MEMBER] })
  })

  it('announces nothing while the Changelog product is off', async () => {
    workspace.changelog = false
    expect(await getChangelogSubscriberTargets(published(OPEN), context)).toEqual([])
  })
})
