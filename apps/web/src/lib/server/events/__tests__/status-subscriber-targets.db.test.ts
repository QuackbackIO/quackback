/**
 * Execution-level tests for status incident emails: each recipient's email
 * lists only the affected components that recipient can see (a
 * segment-restricted component stays out of an outsider's email, exactly as
 * the public page hides it from them), and each component carries the status
 * the incident set on it rather than one label guessed from the impact. The
 * impact each recipient is told is worked out from the components they can
 * see, so a restricted component's outage doesn't show through it.
 *
 * Runs the real target resolver against the real database, inside the
 * test-DB fixture's always-rolled-back transaction: each test seeds its own
 * rows, and no other test file ever sees them. Peripheral services (status
 * settings, unsubscribe tokens, notification preferences) are mocked, as in
 * changelog-segment-targets.db. Skips when no database is reachable.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

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
} from '@/lib/server/db'
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

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: statusSubscriptions.id }).from(statusSubscriptions).limit(0)
  },
})

const context: HookContext = {
  workspaceName: 'Status Target Test',
  portalBaseUrl: 'https://portal.example.com',
  logoUrl: null,
  postWord: 'idea' as const,
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

// Scheduled after the incident above: a window from 02:00 to 04:00 UTC.
const maintenanceScheduled: EventData = {
  type: 'status.maintenance_scheduled',
  actor: { type: 'user', principalId: P_MEMBER, displayName: 'Admin' },
  data: {
    incident: {
      id: createId('status_incident'),
      kind: 'maintenance',
      title: `status-maint-${runSuffix}`,
      status: 'scheduled',
      impact: 'maintenance',
      scheduledStartAt: '2026-07-12T02:00:00.000Z',
      scheduledEndAt: '2026-07-12T04:00:00.000Z',
      startedAt: '2026-07-12T02:00:00.000Z',
      componentIds: [API],
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

describe.skipIf(!fixture.available)('status incident emails (execution-level)', () => {
  beforeEach(async () => {
    await fixture.begin()
    await testDb
      .insert(segments)
      .values({ id: SEGMENT, name: `status-tgt-${runSuffix}`, slug: `status-tgt-${runSuffix}` })

    const memberUser = createId('user')
    const outsiderUser = createId('user')
    const pickerUser = createId('user')
    await testDb.insert(user).values([
      { id: memberUser, name: 'Member', email: MEMBER_EMAIL },
      { id: outsiderUser, name: 'Outsider', email: OUTSIDER_EMAIL },
      { id: pickerUser, name: 'Picker', email: PICKER_EMAIL },
    ])
    // Portal users: the default 'member' role is a teammate, who sees every
    // component regardless of segments.
    await testDb.insert(principal).values([
      { id: P_MEMBER, userId: memberUser, role: 'user', createdAt: new Date() },
      { id: P_OUTSIDER, userId: outsiderUser, role: 'user', createdAt: new Date() },
      { id: P_PICKER, userId: pickerUser, role: 'user', createdAt: new Date() },
    ])
    await testDb
      .insert(userSegments)
      .values({ principalId: P_MEMBER, segmentId: SEGMENT, addedBy: 'manual' })

    await testDb.insert(statusComponents).values([
      { id: API, name: `API ${runSuffix}` },
      // Only members of SEGMENT can see this one on the public page.
      { id: BILLING, name: `Billing ${runSuffix}`, segmentIds: [SEGMENT] },
    ])
    await testDb.insert(statusIncidents).values({
      id: INCIDENT,
      kind: 'incident',
      title: `status-tgt-${runSuffix}`,
      status: 'investigating',
      impact: 'critical',
    })
    await testDb.insert(statusIncidentComponents).values([
      { incidentId: INCIDENT, componentId: API, componentStatus: 'degraded_performance' },
      { incidentId: INCIDENT, componentId: BILLING, componentStatus: 'major_outage' },
    ])
    await testDb.insert(statusSubscriptions).values([
      { principalId: P_MEMBER, scope: 'page', source: 'admin' },
      { principalId: P_OUTSIDER, scope: 'page', source: 'admin' },
      // Chose only Billing, which was later restricted to a segment they
      // aren't in: the API outage is nothing they asked to hear about.
      { principalId: P_PICKER, scope: 'components', componentIds: [BILLING], source: 'self_serve' },
    ])
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('sends no subscriber email or bell for a publication made without emailing subscribers', async () => {
    const created = incidentCreated as unknown as { data: { incident: object } }
    const quiet = {
      ...created,
      data: { incident: { ...created.data.incident, notifySubscribers: false } },
    } as unknown as EventData
    expect(await getStatusSubscriberTargets(quiet, context)).toEqual([])
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

  it('tells each recipient the impact of the components they can see', async () => {
    const targets = await getStatusSubscriberTargets(incidentCreated, context)
    const emailedImpacts = Object.fromEntries(
      targets
        .filter((t) => t.type === 'email')
        .map((t) => [
          (t.target as { email: string }).email,
          (t.config as { impact: string }).impact,
        ])
        .filter(([email]) => String(email).includes(runSuffix))
    )
    // Billing's major outage made the incident critical; the outsider can
    // only see API, which is degraded.
    expect(emailedImpacts).toEqual({ [MEMBER_EMAIL]: 'critical', [OUTSIDER_EMAIL]: 'minor' })

    const notifiedImpact = (id: PrincipalId) =>
      targets.find(
        (t) =>
          t.type === 'notification' &&
          (t.target as { principalIds: string[] }).principalIds.includes(id)
      )?.config.impact
    expect(notifiedImpact(P_MEMBER)).toBe('critical')
    expect(notifiedImpact(P_OUTSIDER)).toBe('minor')
  })

  it('tells a subscriber who chose components only about those they can see', async () => {
    const targets = await getStatusSubscriberTargets(incidentCreated, context)
    expect(Object.keys(emailedComponents(targets))).not.toContain(PICKER_EMAIL)
  })

  it('gives maintenance windows on the 24-hour clock, as the status page does', async () => {
    const targets = await getStatusSubscriberTargets(maintenanceScheduled, context)
    const email = targets.find(
      (t) => t.type === 'email' && (t.target as { email: string }).email === OUTSIDER_EMAIL
    )
    const config = email?.config as { scheduledStartLabel: string; scheduledEndLabel: string }
    expect(config.scheduledStartLabel).toMatch(/July 12, 2026.* 02:00 UTC$/)
    expect(config.scheduledEndLabel).toMatch(/July 12, 2026.* 04:00 UTC$/)
    expect(`${config.scheduledStartLabel} ${config.scheduledEndLabel}`).not.toMatch(/AM|PM/)
  })
})
