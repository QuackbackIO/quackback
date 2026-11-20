/**
 * Helpers for the status page specs (e2e/tests/status/).
 *
 * Service status, the hero headline and the overview tiles are shared by every
 * test, so each test makes its own services (named with its marker) and reads
 * back only its own rows. Incidents and windows made here default to
 * `notifySubscribers: false`: a publish email goes to every subscriber in the
 * workspace, so only the notification specs turn it on.
 *
 *   const api = await personApi(playwright, 'admin')
 *   const svc = await createService(api, `${marker} API`)
 *   const inc = await createIncident(api, { title: marker, services: [[svc.id, 'major_outage']] })
 *   expect((await serviceRow(svc.id)).status).toBe('major_outage')
 */
import { createHmac } from 'node:crypto'
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
  type PlaywrightWorkerArgs,
} from '@playwright/test'
import { fromUuid, generateId, toUuid } from '@quackback/ids'
import { pollFor, supportDb } from '../support/db'
import { supportEnv } from '../support/env'
import { callServerFn, type ServerFnResult } from '../support/server-fns'
import { mintCustomer, mintSessionToken, type MintedCustomer } from '../support/widget-portal'

export type ServiceStatus =
  'operational' | 'degraded_performance' | 'partial_outage' | 'major_outage' | 'under_maintenance'

export type Lifecycle =
  | 'investigating'
  | 'identified'
  | 'monitoring'
  | 'resolved'
  | 'scheduled'
  | 'in_progress'
  | 'verifying'
  | 'completed'

/** Wire shape of an admin incident (serializeIncident in functions/status.ts). */
export interface AdminIncident {
  id: string
  kind: 'incident' | 'maintenance'
  title: string
  status: Lifecycle
  impact: string
  impactOverride: boolean
  scheduledStartAt: string | null
  scheduledEndAt: string | null
  autoStart: boolean
  autoComplete: boolean
  startedAt: string
  resolvedAt: string | null
  notifiedAt: string | null
  backfilled: boolean
  notifySubscribers: boolean
  updates: { id: string; status: Lifecycle; body: string; createdAt: string }[]
  components?: { componentId: string; componentStatus: ServiceStatus }[]
  [k: string]: unknown
}

export interface Service {
  id: string
  name: string
  status: ServiceStatus
  [k: string]: unknown
}

// ---------------------------------------------------------------------------
// Server functions
// ---------------------------------------------------------------------------

/** Call a status server fn and fail the test if it threw. */
export async function must<T = unknown>(
  api: APIRequestContext,
  name: string,
  data?: unknown,
  opts: { method?: 'GET' | 'POST' } = {}
): Promise<T> {
  const res = await callServerFn<T>(api, name, data, opts)
  expect(res.ok, `${name} failed: ${res.raw.slice(0, 400)}`).toBe(true)
  return res.data
}

/** Call a status server fn and expect it to refuse; returns the result. */
export async function refused(
  api: APIRequestContext,
  name: string,
  data?: unknown,
  opts: { method?: 'GET' | 'POST' } = {}
): Promise<ServerFnResult> {
  const res = await callServerFn(api, name, data, opts)
  expect(res.ok, `${name} should have been refused: ${res.raw.slice(0, 300)}`).toBe(false)
  return res
}

export async function createService(
  api: APIRequestContext,
  name: string,
  extra: {
    status?: ServiceStatus
    groupId?: string | null
    segmentIds?: string[]
    showUptime?: boolean
    description?: string | null
  } = {}
): Promise<Service> {
  return must<Service>(api, 'createStatusComponentFn', { name, ...extra })
}

export async function setServiceStatus(api: APIRequestContext, id: string, status: ServiceStatus) {
  await must(api, 'setStatusComponentStatusFn', { id, status })
}

export interface IncidentInput {
  title: string
  services: [string, ServiceStatus][]
  kind?: 'incident' | 'maintenance'
  status?: Lifecycle
  body?: string
  impact?: string
  impactOverride?: boolean
  scheduledStartAt?: Date | string | null
  scheduledEndAt?: Date | string | null
  autoStart?: boolean
  autoComplete?: boolean
  backfill?: { startedAt: Date | string; resolvedAt: Date | string }
  notifySubscribers?: boolean
  templateId?: string
}

function incidentPayload(input: IncidentInput): Record<string, unknown> {
  const kind = input.kind ?? 'incident'
  const { services, ...rest } = input
  return {
    kind,
    status: input.status ?? (kind === 'maintenance' ? 'scheduled' : 'investigating'),
    body: input.body ?? `First update for ${input.title}`,
    notifySubscribers: input.notifySubscribers ?? false,
    ...rest,
    affectedComponents: services.map(([componentId, componentStatus]) => ({
      componentId,
      componentStatus,
    })),
  }
}

/** Create an incident (or a window, with kind 'maintenance') through the server fn. */
export async function createIncident(
  api: APIRequestContext,
  input: IncidentInput
): Promise<AdminIncident> {
  const incident = await must<AdminIncident>(api, 'createStatusIncidentFn', incidentPayload(input))
  made.add(incident.id)
  return incident
}

/** Incidents and windows made by createIncident in this worker since the last cleanup. */
const made = new Set<string>()

/**
 * Delete what this test's helpers created. The feed keeps every open
 * incident's newest entry within its 50-item cap, so open incidents left
 * behind would crowd later tests' items out of it. Call in afterEach.
 */
export async function deleteMadeIncidents(api: APIRequestContext): Promise<void> {
  const ids = [...made]
  made.clear()
  for (const id of ids) await callServerFn(api, 'deleteStatusIncidentFn', { id })
}

/** The same call, without failing: for refusals. */
export async function tryCreateIncident(api: APIRequestContext, input: IncidentInput) {
  return callServerFn<AdminIncident>(api, 'createStatusIncidentFn', incidentPayload(input))
}

/** A maintenance window starting and ending `startMin` / `endMin` minutes from now. */
export async function scheduleWindow(
  api: APIRequestContext,
  input: Omit<IncidentInput, 'kind'> & { startMin?: number; endMin?: number }
): Promise<AdminIncident> {
  const { startMin = 60, endMin = 120, ...rest } = input
  return createIncident(api, {
    kind: 'maintenance',
    scheduledStartAt: minutesFromNow(startMin),
    scheduledEndAt: minutesFromNow(endMin),
    ...rest,
  })
}

export async function postUpdate(
  api: APIRequestContext,
  id: string,
  status: Lifecycle,
  body: string,
  extra: { skipRestore?: boolean; templateId?: string } = {}
): Promise<AdminIncident> {
  return must<AdminIncident>(api, 'postStatusIncidentUpdateFn', { id, status, body, ...extra })
}

export async function getIncidentAdmin(api: APIRequestContext, id: string) {
  return must<AdminIncident | null>(api, 'getStatusIncidentAdminFn', { id }, { method: 'GET' })
}

export function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000)
}

// ---------------------------------------------------------------------------
// Rows the product promises
// ---------------------------------------------------------------------------

const uuid = (typeId: string) => toUuid(typeId as `status_component_${string}`)

export interface ServiceRowDb {
  id: string
  name: string
  status: ServiceStatus
  group_id: string | null
  position: number
  show_uptime: boolean
  segment_ids: string[]
  deleted_at: Date | null
  description: string | null
}

export async function serviceRow(id: string): Promise<ServiceRowDb> {
  const [row] = await supportDb()<ServiceRowDb[]>`
    SELECT id, name, status, group_id, position, show_uptime, segment_ids, deleted_at, description
    FROM status_components WHERE id = ${uuid(id)}`
  if (!row) throw new Error(`no status component ${id}`)
  return row
}

export interface IncidentRowDb {
  id: string
  kind: string
  title: string
  status: Lifecycle
  impact: string
  impact_override: boolean
  scheduled_start_at: Date | null
  scheduled_end_at: Date | null
  auto_start: boolean
  auto_complete: boolean
  started_at: Date
  resolved_at: Date | null
  backfilled: boolean
  notified_at: Date | null
  notify_subscribers: boolean
  details_edited_at: Date | null
  created_by: string | null
  deleted_at: Date | null
  created_at: Date
  updated_at: Date
}

export async function incidentRow(id: string): Promise<IncidentRowDb> {
  const [row] = await supportDb()<IncidentRowDb[]>`
    SELECT * FROM status_incidents WHERE id = ${uuid(id)}`
  if (!row) throw new Error(`no status incident ${id}`)
  return row
}

/** The incident's timeline, oldest first. */
export async function incidentUpdates(id: string) {
  return supportDb()<
    { status: Lifecycle; body: string; created_at: Date; template_id: string | null }[]
  >`SELECT status, body, created_at, template_id FROM status_incident_updates
    WHERE incident_id = ${uuid(id)} ORDER BY created_at, id`
}

/** The incident's affected-service links. */
export async function incidentLinks(id: string) {
  return supportDb()<{ component_id: string; component_status: ServiceStatus }[]>`
    SELECT component_id, component_status FROM status_incident_components
    WHERE incident_id = ${uuid(id)}`
}

/** A service's status history (the uptime source), oldest first. */
export async function serviceEvents(id: string) {
  return supportDb()<
    { status: ServiceStatus; source: string; incident_id: string | null; created_at: Date }[]
  >`SELECT status, source, incident_id, created_at FROM status_component_events
    WHERE component_id = ${uuid(id)} ORDER BY created_at, id`
}

/** Domain events written for an incident or service (TypeID), oldest first. */
export async function domainEvents(entityId: string) {
  return supportDb()<{ type: string; payload: Record<string, unknown>; actor_type: string }[]>`
    SELECT type, payload, actor_type FROM events WHERE entity_id = ${entityId} ORDER BY id`
}

export async function domainEventTypes(entityId: string): Promise<string[]> {
  return (await domainEvents(entityId)).map((e) => e.type)
}

/**
 * Move a window's planned bounds (the handlers compare them with the wall
 * clock). A window still scheduled is dated at its planned start, so that
 * moves with it, as it would had the window been planned that way.
 */
export async function backdateWindow(
  id: string,
  bounds: { start?: Date; end?: Date }
): Promise<void> {
  const sql = supportDb()
  if (bounds.start) {
    await sql`UPDATE status_incidents SET scheduled_start_at = ${bounds.start},
      started_at = CASE WHEN status = 'scheduled' THEN ${bounds.start} ELSE started_at END
      WHERE id = ${uuid(id)}`
  }
  if (bounds.end) {
    await sql`UPDATE status_incidents SET scheduled_end_at = ${bounds.end}
      WHERE id = ${uuid(id)}`
  }
}

/**
 * Pending scheduler jobs for a window's current schedule (`start` /
 * `complete`). Jobs keyed by an older schedule (a backdated or moved window)
 * are left out: their handlers re-check the row and do nothing.
 */
export async function maintenanceJobs(id: string) {
  const row = await incidentRow(id)
  const hash = `${row.scheduled_start_at?.getTime() ?? 'none'}-${row.scheduled_end_at?.getTime() ?? 'none'}`
  const rows = await supportDb()<{ job_id: string; run_at: Date }[]>`
    SELECT dedupe_key AS job_id, run_at FROM job_queue
    WHERE dedupe_key LIKE ${`status-maintenance-%--${id}--${hash}`} AND status = 'pending'
    ORDER BY dedupe_key`
  return rows.map((r) => {
    const m = /^status-maintenance-(start|complete)--/.exec(r.job_id)
    return { kind: m?.[1] ?? '?', hash, runAt: r.run_at }
  })
}

/** Run the scheduler's safety net (every overdue window in the workspace). */
export async function runMaintenanceSweep(request: APIRequestContext): Promise<void> {
  const res = await request.post('/api/e2e/sweep', { data: { job: 'status-maintenance' } })
  expect(res.status(), await res.text()).toBe(200)
}

/** Choose a date and time in a DateTimePicker opened by `trigger`. */
export async function pickDateTime(page: Page, trigger: Locator, when: Date): Promise<void> {
  await trigger.click()
  const iso = [
    when.getFullYear(),
    String(when.getMonth() + 1).padStart(2, '0'),
    String(when.getDate()).padStart(2, '0'),
  ].join('-')
  const day = page.locator(`[data-day="${iso}"]:not([data-outside]) button`)
  if ((await day.count()) === 0) {
    await page.getByRole('button', { name: /next month/i }).click()
  }
  await day.click()
  const hh = String(when.getHours()).padStart(2, '0')
  const mm = String(when.getMinutes()).padStart(2, '0')
  await page.locator('input[type="time"]').fill(`${hh}:${mm}`)
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-day]').first()).toBeHidden()
}

export async function pollIncident(
  id: string,
  what: string,
  check: (row: IncidentRowDb) => boolean,
  timeoutMs = 10_000
): Promise<IncidentRowDb> {
  return pollFor(
    `${what} (${id})`,
    async () => {
      const row = await incidentRow(id)
      return check(row) ? row : null
    },
    { timeoutMs }
  )
}

/** A manual segment only this test uses, with the given members (principal uuids). */
export async function createSegment(marker: string, memberUuids: string[] = []) {
  const id = toUuid(generateId('segment'))
  const slug = `${marker}-${Math.random().toString(36).slice(2, 7)}`.toLowerCase()
  await supportDb()`INSERT INTO segments (id, name, slug, type)
    VALUES (${id}, ${`Segment ${slug}`}, ${slug}, 'manual')`
  for (const principalId of memberUuids) {
    await supportDb()`INSERT INTO user_segments (principal_id, segment_id) VALUES (${principalId}, ${id})`
  }
  return { id: fromUuid('segment', id), uuid: id }
}

// ---------------------------------------------------------------------------
// Subscribers
// ---------------------------------------------------------------------------

export interface PortalUser extends MintedCustomer {
  /** A request context signed in as them (for callServerFn). */
  api: APIRequestContext
  cookieValue: string
}

/** A fresh portal user with a signed-in request context. One subscription row per person. */
export async function mintPortalUser(
  playwright: PlaywrightWorkerArgs['playwright'],
  marker: string,
  label = 'sub'
): Promise<PortalUser> {
  const email = `${marker}-${label}-${Math.random().toString(36).slice(2, 7)}@customers.example`
  const customer = await mintCustomer({ email, name: `Sub ${label} ${marker.slice(-6)}` })
  const env = supportEnv()
  const token = await mintSessionToken(customer.userUuid)
  const signature = createHmac('sha256', env.app.SECRET_KEY).update(token).digest('base64')
  const cookieValue = encodeURIComponent(`${token}.${signature}`)
  const domain = new URL(env.baseUrl).hostname
  const api = await playwright.request.newContext({
    baseURL: env.baseUrl,
    storageState: {
      cookies: [
        {
          name: 'better-auth.session_token',
          value: cookieValue,
          domain,
          path: '/',
          expires: Math.floor(Date.now() / 1000) + 86_400,
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    },
  })
  return { ...customer, api, cookieValue }
}

/** Subscribe a portal user through the portal's own server fn. */
export async function subscribeAs(
  user: PortalUser,
  scope: 'page' | 'components' = 'page',
  componentIds: string[] = []
): Promise<void> {
  await must(user.api, 'subscribeStatusFn', { scope, componentIds })
}

/** Unsubscribe (so a page-wide subscriber stops receiving other tests' mail). */
export async function unsubscribeAs(user: PortalUser): Promise<void> {
  await callServerFn(user.api, 'unsubscribeStatusFn', undefined)
}

export async function subscriptionRow(principalUuid: string) {
  const [row] = await supportDb()<
    {
      scope: string
      component_ids: string[]
      source: string
      unsubscribed_at: Date | null
    }[]
  >`SELECT scope, component_ids, source, unsubscribed_at FROM status_subscriptions
    WHERE principal_id = ${principalUuid}`
  return row ?? null
}

/** Status bells for a person about an incident. */
export async function statusBells(principalUuid: string, incidentId: string) {
  return supportDb()<{ type: string; title: string; body: string | null }[]>`
    SELECT type, title, body FROM in_app_notifications
    WHERE principal_id = ${principalUuid} AND metadata::text LIKE ${`%${incidentId}%`}`
}

// ---------------------------------------------------------------------------
// Admin UI
// ---------------------------------------------------------------------------

type Scope = Page | Locator

const pageOf = (scope: Scope): Page => ('page' in scope ? scope.page() : scope)

/** The affected-services row for a service in a composer or the editor sidebar. */
export function serviceChoice(scope: Scope, name: string): Locator {
  const page = pageOf(scope)
  return scope
    .locator('div', { has: page.getByText(name, { exact: true }) })
    .filter({ has: page.getByRole('checkbox') })
    .last()
}

/**
 * Tick or untick a service in the affected-services list, from the keyboard:
 * in the editor sidebar the modal's footer can sit over a row, and a pointer
 * click then lands on the footer.
 */
export async function toggleService(scope: Scope, name: string): Promise<void> {
  const box = serviceChoice(scope, name).getByRole('checkbox')
  const before = await box.getAttribute('aria-checked')
  await box.focus()
  await box.press('Space')
  await expect(box).not.toHaveAttribute('aria-checked', before ?? 'false')
}

/** Open an admin page and wait for it to hydrate (clicks before that are lost). */
export async function openAdmin(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await page.waitForLoadState('networkidle')
}

/** Pick a status in a row's status menu (StatusSelect). */
export async function pickStatus(page: Page, row: Locator, label: string): Promise<void> {
  await row.getByRole('button').first().click()
  await page.getByRole('button', { name: label, exact: true }).click()
}

/**
 * Type into a list's search box once the page has hydrated (a fill before
 * that is wiped), then wait for `expected` to show.
 */
export async function searchList(
  page: Page,
  text: string,
  expected: Locator,
  placeholder = 'Search incidents…'
): Promise<void> {
  const box = page.getByPlaceholder(placeholder)
  await page.waitForLoadState('networkidle')
  await expect(async () => {
    await box.fill('')
    await box.fill(text)
    await expect(expected).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 15_000 })
}

/** The message a refused server fn call carries (typed or plain error). */
export function messageOf(res: ServerFnResult): string {
  const found: string[] = []
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const n = node as { p?: { k?: string[]; v?: unknown[] }; s?: unknown }
    if (n.p?.k && n.p.v) {
      const i = n.p.k.indexOf('message')
      const v = i === -1 ? undefined : (n.p.v[i] as { s?: unknown } | undefined)
      if (v && typeof v.s === 'string') found.push(v.s)
    }
    if (n.s && typeof n.s === 'object' && 'message' in n.s) {
      const m = (n.s as { message?: { s?: unknown } }).message
      if (m && typeof m.s === 'string') found.push(m.s)
    }
    for (const value of Object.values(n)) {
      if (Array.isArray(value)) value.forEach(walk)
      else walk(value)
    }
  }
  try {
    walk(JSON.parse(res.raw))
  } catch {
    return res.raw
  }
  // seroval writes strings as JS literals: undo its backslash escapes.
  return (found[0] ?? res.raw).replace(/\\(.)/g, '$1')
}

export interface PublicService {
  id: string
  name: string
  status: ServiceStatus
  showUptime: boolean
}

export interface PublicSnapshot {
  activeIncidents: { id: string; title: string }[]
  upcomingMaintenance: { id: string; title: string }[]
  recentIncidents: { date: string; incidents: { id: string; title: string }[] }[]
  ungroupedComponents: PublicService[]
  groups: { id: string; name: string; collapsed: boolean; components: PublicService[] }[]
  [k: string]: unknown
}

/** getStatusPageFn as whoever `api` is; the snapshot part. */
export async function publicSnapshot(api: APIRequestContext): Promise<PublicSnapshot> {
  const page = await must<{ snapshot: PublicSnapshot }>(api, 'getStatusPageFn', undefined, {
    method: 'GET',
  })
  return page.snapshot
}

export const recentIds = (s: PublicSnapshot) =>
  s.recentIncidents.flatMap((d) => d.incidents.map((i) => i.id))

export const publicServiceIds = (s: PublicSnapshot) => [
  ...s.ungroupedComponents.map((c) => c.id),
  ...s.groups.flatMap((g) => g.components.map((c) => c.id)),
]
