/**
 * Execution-level tests for changelog segment targeting: when a changelog
 * entry carries a non-empty `segmentIds` list, `getChangelogSubscriberTargets`
 * must restrict the publish fan-out (email + in-app) to subscribers who are
 * members of at least one targeted segment. An empty list keeps the broadcast
 * to every subscriber.
 *
 * Runs the real target resolver against the real database: the global `db`
 * proxy is pre-seeded with this file's own short-lived connection (closed in
 * afterAll) so the resolver executes its actual SQL. Peripheral services the
 * resolver fans out to (settings, sending address, unsubscribe tokens,
 * notification preferences) are mocked so the test exercises only the
 * subscriber-selection SQL.
 *
 * Connects via DATABASE_URL (vitest pins quackback_test), falling back to the
 * dev DB; skips gracefully when neither is reachable — same pattern as
 * help-center-segment-gate.integration.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { sql, inArray } from 'drizzle-orm'

vi.mock('@/lib/server/domains/settings/settings.changelog', () => ({
  getChangelogSettings: vi.fn().mockResolvedValue({
    audience: 'public',
    showInNav: true,
    allowComments: true,
    autoSubscribe: false,
    emailsDisabled: false,
  }),
}))
vi.mock('@/lib/server/domains/channel-accounts/channel-account.service', () => ({
  resolveSendingAddress: vi.fn().mockResolvedValue(null),
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
  changelogEntries,
  changelogSubscriptions,
  principal,
  segments,
  user,
  userSegments,
  type Database,
} from '@/lib/server/db'

import { createDb } from '@quackback/db/client'
import { createId, type ChangelogId, type PrincipalId, type SegmentId } from '@quackback/ids'
import { getChangelogSubscriberTargets } from '../targets'
import type { EventData } from '../types'
import type { HookContext } from '../hook-context'

const runSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const SEG_TARGET = createId('segment') as SegmentId
const SEG_EMPTY = createId('segment') as SegmentId
const P_MEMBER = createId('principal') as PrincipalId
const P_OUTSIDER = createId('principal') as PrincipalId
const P_AUTHOR = createId('principal') as PrincipalId
const ENTRY_OPEN = createId('changelog') as ChangelogId
const ENTRY_GATED = createId('changelog') as ChangelogId
const ENTRY_EMPTY_SEG = createId('changelog') as ChangelogId
const MEMBER_EMAIL = `seg-member-${runSuffix}@example.com`
const OUTSIDER_EMAIL = `seg-outsider-${runSuffix}@example.com`

const CANDIDATE_URLS = [
  process.env.DATABASE_URL,
  'postgresql://postgres:password@localhost:5432/quackback',
].filter((u): u is string => !!u)

async function pickWorkingDb(): Promise<{ db: Database; close: () => Promise<void> } | null> {
  for (const url of CANDIDATE_URLS) {
    try {
      const db = createDb(url, { max: 4, prepare: false })
      await db.execute(sql`select 1`)
      return {
        db,
        close: async () => {
          const raw = (db as unknown as { $client?: { end?: () => Promise<void> } }).$client
          await raw?.end?.()
        },
      }
    } catch {
      // try next candidate
    }
  }
  return null
}

let activeDb: Database | null = null
let closeDb: (() => Promise<void>) | null = null

const resolved = await pickWorkingDb()
const dbAvailable = resolved !== null
if (resolved) {
  activeDb = resolved.db
  closeDb = resolved.close
  // Point the app's global db singleton at this file's connection so the
  // resolver under test runs real SQL and the pool can be closed.
  ;(globalThis as Record<string, unknown>).__db = resolved.db
}

const context: HookContext = {
  workspaceName: 'Seg Target Test',
  portalBaseUrl: 'https://portal.example.com',
  logoUrl: null,
}

function publishEvent(changelogId: string): EventData {
  return {
    type: 'changelog.published',
    actor: { type: 'user', principalId: P_AUTHOR, displayName: 'Author' },
    data: {
      changelog: {
        id: changelogId,
        title: 'Segmented release',
        contentPreview: 'preview',
        contentHtml: '<p>preview</p>',
        publishedAt: new Date().toISOString(),
        linkedPostCount: 0,
      },
    },
  } as EventData
}

/** Project the delivery addresses of the email targets for one run. */
function emailAddresses(
  targets: Awaited<ReturnType<typeof getChangelogSubscriberTargets>>
): string[] {
  return targets
    .filter((t) => t.type === 'email')
    .map((t) => (t.target as { email: string }).email)
    .filter((e) => e.includes(runSuffix))
    .sort()
}

/** Principal IDs of the in-app notification target (one aggregate target). */
function notificationPrincipalIds(
  targets: Awaited<ReturnType<typeof getChangelogSubscriberTargets>>
): string[] {
  return targets
    .filter((t) => t.type === 'notification')
    .flatMap((t) => (t.target as { principalIds: string[] }).principalIds)
    .filter((id) => id === P_MEMBER || id === P_OUTSIDER)
    .sort()
}

describe.skipIf(!dbAvailable)('changelog segment targeting (execution-level)', () => {
  beforeAll(async () => {
    if (!activeDb) return
    await activeDb
      .delete(changelogEntries)
      .where(sql`${changelogEntries.title} LIKE ${`seg-tgt-${runSuffix}%`}`)

    await activeDb
      .insert(segments)
      .values([
        { id: SEG_TARGET, name: `seg-tgt-${runSuffix}`, slug: `seg-tgt-${runSuffix}` },
        { id: SEG_EMPTY, name: `seg-empty-${runSuffix}`, slug: `seg-empty-${runSuffix}` },
      ])
      .onConflictDoNothing()

    const memberUser = createId('user')
    const outsiderUser = createId('user')
    await activeDb.insert(user).values([
      { id: memberUser, name: 'Member', email: MEMBER_EMAIL },
      { id: outsiderUser, name: 'Outsider', email: OUTSIDER_EMAIL },
    ])
    await activeDb
      .insert(principal)
      .values([
        { id: P_MEMBER, userId: memberUser, createdAt: new Date() },
        { id: P_OUTSIDER, userId: outsiderUser, createdAt: new Date() },
        { id: P_AUTHOR, createdAt: new Date() },
      ])
      .onConflictDoNothing()

    await activeDb
      .insert(changelogSubscriptions)
      .values({ principalId: P_MEMBER, source: 'admin' as const })
    await activeDb
      .insert(changelogSubscriptions)
      .values({ principalId: P_OUTSIDER, source: 'admin' as const })

    // Only the member principal belongs to the targeted segment; SEG_EMPTY
    // has no members at all.
    await activeDb
      .insert(userSegments)
      .values({ principalId: P_MEMBER, segmentId: SEG_TARGET, addedBy: 'manual' })

    await activeDb.insert(changelogEntries).values([
      {
        id: ENTRY_OPEN,
        title: `seg-tgt-${runSuffix}-open`,
        content: 'open entry',
        principalId: P_AUTHOR,
        publishedAt: new Date(Date.now() - 60_000),
        segmentIds: [],
      },
      {
        id: ENTRY_GATED,
        title: `seg-tgt-${runSuffix}-gated`,
        content: 'gated entry',
        principalId: P_AUTHOR,
        publishedAt: new Date(Date.now() - 60_000),
        segmentIds: [SEG_TARGET],
      },
      {
        id: ENTRY_EMPTY_SEG,
        title: `seg-tgt-${runSuffix}-empty-seg`,
        content: 'empty-segment entry',
        principalId: P_AUTHOR,
        publishedAt: new Date(Date.now() - 60_000),
        segmentIds: [SEG_EMPTY],
      },
    ])
  })

  afterAll(async () => {
    if (activeDb) {
      await activeDb
        .delete(changelogEntries)
        .where(sql`${changelogEntries.title} LIKE ${`seg-tgt-${runSuffix}%`}`)
      await activeDb
        .delete(changelogSubscriptions)
        .where(inArray(changelogSubscriptions.principalId, [P_MEMBER, P_OUTSIDER]))
      await activeDb.delete(segments).where(sql`${segments.slug} LIKE ${`seg-%-${runSuffix}`}`)
      await activeDb.delete(user).where(sql`${user.email} LIKE ${`seg-%-${runSuffix}@example.com`}`)
    }
    delete (globalThis as Record<string, unknown>).__db
    await closeDb?.()
  })

  it('ungated entry broadcasts to every subscriber', async () => {
    const targets = await getChangelogSubscriberTargets(publishEvent(ENTRY_OPEN), context)
    expect(emailAddresses(targets)).toEqual([MEMBER_EMAIL, OUTSIDER_EMAIL].sort())
    expect(notificationPrincipalIds(targets)).toEqual([P_MEMBER, P_OUTSIDER].sort())
  })

  it('segment-targeted entry emails only subscribers in that segment', async () => {
    const targets = await getChangelogSubscriberTargets(publishEvent(ENTRY_GATED), context)
    expect(emailAddresses(targets)).toEqual([MEMBER_EMAIL])
    expect(notificationPrincipalIds(targets)).toEqual([P_MEMBER])
  })

  it('edge case: targeting a segment with no members sends nothing', async () => {
    const targets = await getChangelogSubscriberTargets(publishEvent(ENTRY_EMPTY_SEG), context)
    expect(emailAddresses(targets)).toEqual([])
    expect(notificationPrincipalIds(targets)).toEqual([])
  })
})
