/**
 * Helpers for the segment specs (e2e/tests/people/segments.spec.ts,
 * segment-access.spec.ts): portal users with their own sessions, boards and
 * posts made the way the portal makes them, segments made through the
 * admin's server functions, and REST keys.
 *
 *   const admin = await personApi(playwright, 'admin')
 *   const seg = await createSegment(admin, { name: `Beta ${marker}`, type: 'manual' })
 *   const cass = await portalUser(browser, marker)
 *   await mustCall(admin, 'assignUsersToSegmentFn', { segmentId: seg.id, principalIds: [cass.principalId] })
 *   expect(await membersOf(seg.id)).toEqual([{ principalId: cass.principalId, addedBy: 'manual' }])
 *
 * Segments and people carry the test's marker, so a test finds its own rows
 * and never relies on counts of the shared workspace.
 */
import { randomBytes } from 'node:crypto'
import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type PlaywrightWorkerArgs,
} from '@playwright/test'
import { fromUuid, generateId, toUuid } from '@quackback/ids'
import { supportDb } from '../support/db'
import { supportEnv } from '../support/env'
import { apiFor, createKey, type CreatedKey } from '../support/api-client'
import { callServerFn, type ServerFnResult } from '../support/server-fns'
import { mintCustomer, portalContext, type MintedCustomer } from '../support/widget-portal'

export { personApi, callServerFn } from '../support/server-fns'

function suffix(): string {
  return randomBytes(3).toString('hex')
}

export function uuid(typeId: string): string {
  return toUuid(typeId as `segment_${string}`)
}

// ---------------------------------------------------------------------------
// Server functions
// ---------------------------------------------------------------------------

/** Call a server function and fail the test when it throws. */
export async function mustCall<T = unknown>(
  api: APIRequestContext,
  name: string,
  data?: unknown,
  opts: { sourceFile?: string; method?: 'POST' | 'GET' } = {}
): Promise<T> {
  const res = await callServerFn<T>(api, name, data, opts)
  expect(res.ok, `${name}: ${res.raw.slice(0, 400)}`).toBe(true)
  return res.data
}

/** Call a server function expecting a refusal; returns the result. */
export async function refusedCall(
  api: APIRequestContext,
  name: string,
  data?: unknown,
  opts: { sourceFile?: string; method?: 'POST' | 'GET' } = {}
): Promise<ServerFnResult> {
  const res = await callServerFn(api, name, data, opts)
  expect(res.ok, `${name} should be refused: ${res.raw.slice(0, 300)}`).toBe(false)
  return res
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export interface PortalUser extends MintedCustomer {
  /** A browser context signed in to the portal as them. */
  context: BrowserContext
  /** That context's request client (cookie-authed server functions). */
  api: APIRequestContext
}

/** A fresh identified portal user, signed in. */
export async function portalUser(
  browser: Browser,
  marker: string,
  opts: { name?: string; email?: string } = {}
): Promise<PortalUser> {
  const s = suffix()
  const customer = await mintCustomer({
    email: opts.email ?? `${marker}-${s}@customers.example`,
    name: opts.name ?? `Person ${marker} ${s}`,
  })
  const context = await portalContext(browser, customer)
  return { ...customer, context, api: context.request }
}

/** A portal user with no session (only rows). */
export async function portalUserRow(
  marker: string,
  opts: { name?: string; email?: string; verified?: boolean } = {}
): Promise<MintedCustomer> {
  const s = suffix()
  const customer = await mintCustomer({
    email: opts.email ?? `${marker}-${s}@customers.example`,
    name: opts.name ?? `Person ${marker} ${s}`,
  })
  if (opts.verified === false) {
    await supportDb()`UPDATE "user" SET email_verified = false WHERE id = ${customer.userUuid}`
  }
  return customer
}

/**
 * An anonymous principal shaped like the anonymous auth plugin makes one
 * (placeholder email on the reserved domain).
 */
export async function seedAnonymous(marker: string): Promise<MintedCustomer> {
  const sql = supportDb()
  const userUuid = toUuid(generateId('user'))
  const principalUuid = toUuid(generateId('principal'))
  const email = `temp-${userUuid}@anon.quackback.io`
  const name = `Lead ${marker} ${suffix()}`
  await sql`INSERT INTO "user" (id, name, email, email_verified, is_anonymous, created_at, updated_at)
            VALUES (${userUuid}, ${name}, ${email}, false, true, NOW(), NOW())`
  await sql`INSERT INTO principal (id, user_id, role, type, display_name, created_at)
            VALUES (${principalUuid}, ${userUuid}, 'user', 'anonymous', ${name}, NOW())`
  return {
    email,
    name,
    userId: fromUuid('user', userUuid),
    principalId: fromUuid('principal', principalUuid),
    userUuid,
    principalUuid,
  }
}

/** Merge keys into a person's user.metadata (custom attribute values). */
export async function setUserMetadata(
  userUuid: string,
  values: Record<string, unknown>
): Promise<void> {
  await supportDb()`UPDATE "user"
    SET metadata = (coalesce(nullif(metadata, '')::jsonb, '{}'::jsonb) || ${JSON.stringify(values)}::text::jsonb)::text
    WHERE id = ${userUuid}`
}

/** A company only this test uses, with a person linked to it. Returns its uuid. */
export async function seedCompany(
  marker: string,
  fields: {
    plan?: string | null
    mrrCents?: number | null
    size?: string | null
    industry?: string | null
    attrs?: Record<string, unknown>
  }
): Promise<string> {
  const id = toUuid(generateId('company'))
  await supportDb()`INSERT INTO companies (id, name, plan, mrr_cents, size, industry, custom_attributes)
    VALUES (${id}, ${`Company ${marker} ${suffix()}`}, ${fields.plan ?? null}, ${fields.mrrCents ?? null},
            ${fields.size ?? null}, ${fields.industry ?? null}, ${JSON.stringify(fields.attrs ?? {})}::text::jsonb)`
  return id
}

export async function linkCompany(
  principalUuid: string,
  companyUuid: string | null
): Promise<void> {
  await supportDb()`UPDATE principal SET company_id = ${companyUuid} WHERE id = ${principalUuid}`
}

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

export interface SegmentCondition {
  attribute: string
  operator: string
  value?: string | number | boolean | Array<string | number>
  metadataKey?: string
}

export interface CreatedSegment {
  id: string
  slug: string
  name: string
}

/** Create a segment through createSegmentFn as `api`. */
export async function createSegment(
  api: APIRequestContext,
  input: {
    name: string
    type: 'manual' | 'dynamic'
    conditions?: SegmentCondition[]
    match?: 'all' | 'any'
    schedule?: { enabled: boolean; pattern: string }
  }
): Promise<CreatedSegment> {
  const seg = await mustCall<{ id: string; slug: string; name: string }>(api, 'createSegmentFn', {
    name: input.name,
    type: input.type,
    ...(input.conditions
      ? { rules: { match: input.match ?? 'all', conditions: input.conditions } }
      : {}),
    ...(input.schedule ? { evaluationSchedule: input.schedule } : {}),
  })
  return { id: seg.id, slug: seg.slug, name: seg.name }
}

/** A dynamic segment, evaluated once; returns the evaluation result too. */
export async function evaluate(
  api: APIRequestContext,
  segmentId: string
): Promise<{ segmentId: string; added: number; removed: number }> {
  return mustCall(api, 'evaluateSegmentFn', { segmentId })
}

export interface Membership {
  principalId: string
  addedBy: string
}

/** The segment's user_segments rows, sorted by principal id. */
export async function membersOf(segmentId: string): Promise<Membership[]> {
  const rows = await supportDb()`SELECT principal_id, added_by FROM user_segments
    WHERE segment_id = ${uuid(segmentId)} ORDER BY principal_id`
  return rows.map((r) => ({
    principalId: fromUuid('principal', r.principal_id as string),
    addedBy: r.added_by as string,
  }))
}

/** Principal ids in the segment, sorted. */
export async function memberIds(segmentId: string): Promise<string[]> {
  return (await membersOf(segmentId)).map((m) => m.principalId).sort()
}

/** The raw segments row. */
export async function segmentRow(segmentId: string): Promise<Record<string, unknown>> {
  const [row] = await supportDb()`SELECT * FROM segments WHERE id = ${uuid(segmentId)}`
  if (!row) throw new Error(`no segment ${segmentId}`)
  return row
}

/** Audit rows for a segment target, oldest first. */
export async function segmentAudit(
  segmentId: string,
  eventType?: string
): Promise<
  Array<{ event_type: string; actor_email: string | null; metadata: Record<string, unknown> }>
> {
  const rows = await supportDb()`SELECT event_type, actor_email, metadata FROM audit_log
    WHERE target_id = ${segmentId} ORDER BY occurred_at, id`
  const all = rows as unknown as Array<{
    event_type: string
    actor_email: string | null
    metadata: Record<string, unknown>
  }>
  return eventType ? all.filter((r) => r.event_type === eventType) : all
}

// ---------------------------------------------------------------------------
// Boards and posts
// ---------------------------------------------------------------------------

/** A public board only this test uses. */
export async function seedBoard(
  marker: string
): Promise<{ id: string; slug: string; name: string }> {
  const id = toUuid(generateId('board'))
  const slug = `${marker}-${suffix()}`.slice(0, 60)
  const name = `Board ${marker}`.slice(0, 90)
  await supportDb()`INSERT INTO boards (id, slug, name, description)
                    VALUES (${id}, ${slug}, ${name}, 'people e2e board')`
  return { id: fromUuid('board', id), slug, name }
}

export type Tier = 'anonymous' | 'authenticated' | 'segments' | 'team'

/** Set a board's per-action tiers and segment lists through updateBoardAccessFn. */
export async function setBoardAccess(
  admin: APIRequestContext,
  boardId: string,
  tiers: Partial<Record<'view' | 'vote' | 'comment' | 'submit', Tier>>,
  segments: Partial<Record<'view' | 'vote' | 'comment' | 'submit', string[]>>
): Promise<ServerFnResult> {
  return callServerFn(admin, 'updateBoardAccessFn', {
    boardId,
    access: {
      view: tiers.view ?? 'anonymous',
      vote: tiers.vote ?? 'anonymous',
      comment: tiers.comment ?? 'anonymous',
      submit: tiers.submit ?? 'anonymous',
      segments: {
        view: segments.view ?? [],
        vote: segments.vote ?? [],
        comment: segments.comment ?? [],
        submit: segments.submit ?? [],
      },
      moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
    },
  })
}

/** A post on a board, written straight in the database (author: `principalUuid`). */
export async function seedPost(
  boardId: string,
  principalUuid: string,
  title: string
): Promise<{ id: string }> {
  const id = toUuid(generateId('post'))
  const [status] = await supportDb()`SELECT id FROM post_statuses WHERE is_default = true LIMIT 1`
  await supportDb()`INSERT INTO posts (id, board_id, principal_id, title, content, status_id)
    VALUES (${id}, ${toUuid(boardId as `board_${string}`)}, ${principalUuid}, ${title},
            ${`Body of ${title}`}, ${(status?.id as string | undefined) ?? null})`
  return { id: fromUuid('post', id) }
}

// ---------------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------------

let adminKey: CreatedKey | null = null

/** A workspace key holding the admin role, made once per worker. */
export function adminWorkspaceKey(): CreatedKey {
  adminKey ??= createKey({
    creatorEmail: 'e2e-support-admin@example.com',
    kind: 'workspace',
    roleKey: 'admin',
  })
  return adminKey
}

/** A REST client with the per-worker admin workspace key. */
export async function restAdmin(
  playwright: PlaywrightWorkerArgs['playwright']
): Promise<APIRequestContext> {
  return apiFor(playwright, supportEnv().baseUrl, adminWorkspaceKey().key)
}

/** A REST client with a workspace key holding `roleKey`. */
export async function restAs(
  playwright: PlaywrightWorkerArgs['playwright'],
  roleKey: string
): Promise<APIRequestContext> {
  const { key } = createKey({
    creatorEmail: 'e2e-support-admin@example.com',
    kind: 'workspace',
    roleKey,
  })
  return apiFor(playwright, supportEnv().baseUrl, key)
}

// ---------------------------------------------------------------------------
// Admin UI
// ---------------------------------------------------------------------------

/** The People directory with optional search, profile and segment filter. */
export function usersUrl(opts: {
  search?: string
  selected?: string
  segments?: string[]
}): string {
  const q = new URLSearchParams()
  if (opts.search) q.set('search', opts.search)
  if (opts.selected) q.set('selected', opts.selected)
  if (opts.segments?.length) q.set('segments', opts.segments.join(','))
  const s = q.toString()
  return `/admin/users${s ? `?${s}` : ''}`
}
