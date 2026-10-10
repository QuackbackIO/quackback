/**
 * Execution-level tests for status incident emails: each recipient's email
 * lists only the affected components that recipient can see (a
 * segment-restricted component stays out of an outsider's email, exactly as
 * the public page hides it from them), and each component carries the status
 * the incident set on it rather than one label guessed from the impact.
 *
 * Runs the real target resolver against the real database: the global `db`
 * proxy is pointed at this file's own short-lived connection (closed in
 * afterAll). Peripheral services (status settings, unsubscribe tokens,
 * notification preferences) are mocked, as in changelog-segment-targets.db.
 * Skips when no database is reachable.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { sql, inArray } from 'drizzle-orm'

vi.mock('@/lib/server/domains/settings/settings.status', () => ({
  getStatusSettings: vi.fn().mockResolvedValue({
    enabled: true,
    portalTabEnabled: true,
    audience: 'public',
    allowedSegmentIds: [],
    emailsDisabled: false,
    pageDescription: null,
  }),
}))
vi.mock('@/lib/server/domains/subscriptions/subscription.service', () => ({
  getSubscribersForEvent: vi.fn().mockResolvedValue([]),
  batchGetNotificationPreferences: vi.fn().mockResolvedValue(new Map()),
  batchGenerateUnsubscribeTokens: vi.fn().mockResolvedValue(new Map()),
  batchGenerateStatusUnsubscribeTokens: vi
    .fn()
    .mockImplementation(async (ids: string[]) => new Map(ids.map((id) => [id, `tok-${id}`]))),
}))

import {
  principal,
  segments,
  statusComponents,
  statusIncidents,
  statusIncidentComponents,
  statusSubscriptions,
  user,
  userSegments,
  type Database,
} from '@/lib/server/db'
// oxlint-disable-next-line no-restricted-imports -- legitimate createDb caller: this file owns the global db for its worker (see help-center-segment-gate.integration.test.ts)
import { createDb } from '@quackback/db/client'
import {
  createId,
  type PrincipalId,
  type SegmentId,
  type StatusComponentId,
  type StatusIncidentId,
} from '@quackback/ids'
import { getStatusSubscriberTargets } from '../targets'
import type { EventData } from '../types'
import type { HookContext } from '../hook-context'

const runSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const SEGMENT = createId('segment') as SegmentId
const P_MEMBER = createId('principal') as PrincipalId
const P_OUTSIDER = createId('principal') as PrincipalId
const P_PICKER = createId('principal') as PrincipalId
const API = createId('status_component') as StatusComponentId
const BILLING = createId('status_component') as StatusComponentId
const INCIDENT = createId('status_incident') as StatusIncidentId
const MEMBER_EMAIL = `status-member-${runSuffix}@example.com`
const OUTSIDER_EMAIL = `status-outsider-${runSuffix}@example.com`
const PICKER_EMAIL = `status-picker-${runSuffix}@example.com`

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
  ;(globalThis as Record<string, unknown>).__db = resolved.db
}

const context: HookContext = {
  workspaceName: 'Status Target Test',
  portalBaseUrl: 'https://portal.example.com',
  logoUrl: null,
}

const incidentCreated: EventData = {
  type: 'status.incident_created',
  actor: { type: 'user', principalId: P_MEMBER, displayName: 'Admin' },
  data: {
    incident: {
      id: INCIDENT,
      kind: 'incident',
      title: `status-tgt-${runSuffix}`,
      status: 'investigating',
      // A critical impact once labelled every component "Major outage".
      impact: 'critical',
      scheduledStartAt: null,
      scheduledEndAt: null,
      startedAt: new Date().toISOString(),
      componentIds: [API, BILLING],
    },
  },
} as EventData

/** The affected-component list each recipient's email shows. */
function emailedComponents(targets: Awaited<ReturnType<typeof getStatusSubscriberTargets>>) {
  return Object.fromEntries(
    targets
      .filter((t) => t.type === 'email')
      .map((t) => [
        (t.target as { email: string }).email,
        (t.config as { affectedComponents: Array<{ name: string; status: string }> })
          .affectedComponents,
      ])
      .filter(([email]) => String(email).includes(runSuffix))
  )
}

describe.skipIf(!dbAvailable)('status incident emails (execution-level)', () => {
  beforeAll(async () => {
    if (!activeDb) return
    await activeDb
      .insert(segments)
      .values({ id: SEGMENT, name: `status-tgt-${runSuffix}`, slug: `status-tgt-${runSuffix}` })

    const memberUser = createId('user')
    const outsiderUser = createId('user')
    const pickerUser = createId('user')
    await activeDb.insert(user).values([
      { id: memberUser, name: 'Member', email: MEMBER_EMAIL },
      { id: outsiderUser, name: 'Outsider', email: OUTSIDER_EMAIL },
      { id: pickerUser, name: 'Picker', email: PICKER_EMAIL },
    ])
    // Portal users: the default 'member' role is a teammate, who sees every
    // component regardless of segments.
    await activeDb.insert(principal).values([
      { id: P_MEMBER, userId: memberUser, role: 'user', createdAt: new Date() },
      { id: P_OUTSIDER, userId: outsiderUser, role: 'user', createdAt: new Date() },
      { id: P_PICKER, userId: pickerUser, role: 'user', createdAt: new Date() },
    ])
    await activeDb
      .insert(userSegments)
      .values({ principalId: P_MEMBER, segmentId: SEGMENT, addedBy: 'manual' })

    await activeDb.insert(statusComponents).values([
      { id: API, name: `API ${runSuffix}` },
      // Only members of SEGMENT can see this one on the public page.
      { id: BILLING, name: `Billing ${runSuffix}`, segmentIds: [SEGMENT] },
    ])
    await activeDb.insert(statusIncidents).values({
      id: INCIDENT,
      kind: 'incident',
      title: `status-tgt-${runSuffix}`,
      status: 'investigating',
      impact: 'critical',
    })
    await activeDb.insert(statusIncidentComponents).values([
      { incidentId: INCIDENT, componentId: API, componentStatus: 'degraded_performance' },
      { incidentId: INCIDENT, componentId: BILLING, componentStatus: 'major_outage' },
    ])
    await activeDb.insert(statusSubscriptions).values([
      { principalId: P_MEMBER, scope: 'page', source: 'admin' },
      { principalId: P_OUTSIDER, scope: 'page', source: 'admin' },
      // Chose only Billing, which was later restricted to a segment they
      // aren't in: the API outage is nothing they asked to hear about.
      { principalId: P_PICKER, scope: 'components', componentIds: [BILLING], source: 'self_serve' },
    ])
  }, 60_000)

  afterAll(async () => {
    if (activeDb) {
      await activeDb.delete(statusIncidents).where(inArray(statusIncidents.id, [INCIDENT]))
      await activeDb.delete(statusComponents).where(inArray(statusComponents.id, [API, BILLING]))
      await activeDb.delete(segments).where(inArray(segments.id, [SEGMENT]))
      await activeDb
        .delete(user)
        .where(sql`${user.email} LIKE ${`status-%-${runSuffix}@example.com`}`)
    }
    delete (globalThis as Record<string, unknown>).__db
    await closeDb?.()
  })

  it('lists each component with the status the incident set on it, as far as the recipient can see', async () => {
    const targets = await getStatusSubscriberTargets(incidentCreated, context)
    expect(emailedComponents(targets)).toEqual({
      [MEMBER_EMAIL]: [
        { name: `API ${runSuffix}`, status: 'Degraded performance' },
        { name: `Billing ${runSuffix}`, status: 'Major outage' },
      ],
      // The outsider still hears about the incident (they can see API) but
      // never learns the segment-restricted Billing component exists.
      [OUTSIDER_EMAIL]: [{ name: `API ${runSuffix}`, status: 'Degraded performance' }],
    })

    const notified = targets
      .filter((t) => t.type === 'notification')
      .flatMap((t) => (t.target as { principalIds: string[] }).principalIds)
      .filter((id) => id === P_MEMBER || id === P_OUTSIDER || id === P_PICKER)
      .sort()
    expect(notified).toEqual([P_MEMBER, P_OUTSIDER].sort())
  })

  it('tells a subscriber who chose components only about those they can see', async () => {
    const targets = await getStatusSubscriberTargets(incidentCreated, context)
    expect(Object.keys(emailedComponents(targets))).not.toContain(PICKER_EMAIL)
  })
})
