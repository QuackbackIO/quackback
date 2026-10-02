import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createId, type BoardId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from './db-test-fixture'
import {
  boards,
  eq,
  permissions,
  posts,
  postStatuses,
  principal,
  principalRoleAssignments,
  rolePermissions,
  roles,
  settings,
  user,
  type BoardAccess,
} from '@/lib/server/db'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy/types'
import { can } from '@/lib/server/policy/authorize'
import {
  getPublicBoardById,
  listPublicBoardsWithStats,
} from '@/lib/server/domains/boards/board.public'
import {
  getOrCreateTestCustomer,
  mintTestCustomerToken,
  consumeTestCustomerToken,
} from '../test-customer'
import { resolveTestFeedbackActor } from '../test-customer-feedback'
import { policyActorFromAuth, type AuthContext } from '../functions/auth-helpers'
import { runFetchBoardCapabilities } from '../functions/portal'
import { runCreatePublicPost } from '../functions/public-posts'
import { getOptionalWidgetAuth } from '../functions/widget-auth'
import { DEFAULT_PORTAL_CONFIG } from '../domains/settings/settings.types'

const effects = vi.hoisted(() => ({
  beforeRehost: null as null | (() => Promise<void>),
  headers: new Headers(),
}))
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('./db-test-fixture')).testDb,
}))
vi.mock('@tanstack/react-start', async (original) => ({
  ...(await original<typeof import('@tanstack/react-start')>()),
  createServerOnlyFn: <T>(fn: T) => fn,
}))
vi.mock('@tanstack/react-start/server', () => ({ getRequestHeaders: () => effects.headers }))
vi.mock('@/lib/server/domains/posts/post.service', async (original) => {
  const actual = await original<typeof import('@/lib/server/domains/posts/post.service')>()
  return {
    ...actual,
    createPost: (...args: Parameters<typeof actual.createPost>) =>
      actual.createPost(args[0], args[1], { ...args[2], skipDispatch: true }),
  }
})
vi.mock('@/lib/server/content/rehost-images', () => ({
  rehostExternalImages: async (json: unknown, context: { principalId: PrincipalId }) => {
    expect(context.principalId).toBeTruthy()
    await effects.beforeRehost?.()
    return json
  },
}))
vi.mock('@/lib/server/domains/posts/post.autotag', () => ({
  autoTagPost: async (id: string, title: string, content: string) => {
    expect(id).toMatch(/^post_/)
    expect(title).toBeTruthy()
    expect(typeof content).toBe('string')
    return []
  },
}))
vi.mock('@/lib/server/domains/settings/settings.helpers', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/settings/settings.helpers')>()),
  findSettingsCached: async () => testDb.query.settings.findFirst(),
}))
vi.mock('@/lib/server/domains/settings/settings.service', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/settings/settings.service')>()),
  getPortalConfig: async () => {
    const row = await testDb.query.settings.findFirst()
    return { ...DEFAULT_PORTAL_CONFIG, ...JSON.parse(row!.portalConfig!) }
  },
}))

const fixture = await createDbTestFixture()
let owner: PrincipalId
let customer: PrincipalId
let privateBoard: BoardId
let publicBoard: BoardId
let auth: AuthContext
const access = (view: 'anonymous' | 'team'): BoardAccess => ({
  view,
  submit: view,
  vote: view,
  comment: view,
  segments: { view: [], submit: [], vote: [], comment: [] },
  moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
})
const actorFor = (id: PrincipalId): Actor => ({
  ...ANONYMOUS_ACTOR,
  principalId: id,
  role: 'user',
})

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  expect(process.env.DATABASE_URL).toMatch(/\/quackback_test(?:\?|$)/)
  await fixture.begin()
  effects.beforeRehost = null
  effects.headers = new Headers()
  owner = createId('principal')
  const uid = createId('user')
  await testDb.insert(user).values({ id: uid, name: 'Acme', email: `you+${uid}@example.com` })
  await testDb.insert(principal).values({
    id: owner,
    userId: uid,
    role: 'admin',
    type: 'user',
    createdAt: new Date(),
  })
  const testCustomer = await getOrCreateTestCustomer(owner, 'en')
  customer = testCustomer.id
  privateBoard = createId('board')
  publicBoard = createId('board')
  await testDb.insert(boards).values([
    {
      id: privateBoard,
      name: 'Acme private',
      slug: `private-${privateBoard}`,
      access: access('team'),
    },
    {
      id: publicBoard,
      name: 'Acme public',
      slug: `public-${publicBoard}`,
      access: access('anonymous'),
    },
  ])
  await testDb
    .insert(postStatuses)
    .values({ name: 'Open', slug: 'open', isDefault: true })
    .onConflictDoNothing()
  const existing = await testDb.query.settings.findFirst()
  const config = JSON.stringify({
    ...DEFAULT_PORTAL_CONFIG,
    features: { ...DEFAULT_PORTAL_CONFIG.features, allowAnonymous: false },
  })
  if (existing)
    await testDb.update(settings).set({ portalConfig: config }).where(eq(settings.id, existing.id))
  else
    await testDb
      .insert(settings)
      .values({ name: 'Acme', slug: `acme-${owner}`, createdAt: new Date(), portalConfig: config })
  const workspace = (await testDb.query.settings.findFirst())!
  auth = {
    settings: { id: workspace.id, slug: workspace.slug, name: workspace.name, logoKey: null },
    user: { id: testCustomer.userId!, name: 'Test customer', email: '', image: null },
    principal: { id: customer, role: 'user', type: 'anonymous' },
    permissions: [],
    scope: 'widget',
  }
})
afterEach(fixture.rollback)
afterAll(fixture.close)

async function grantOwner(keys: PermissionKey[]) {
  const rid = createId('role')
  await testDb.insert(roles).values({ id: rid, key: `test-${rid}`, name: 'Acme role' })
  await testDb.insert(principalRoleAssignments).values({ principalId: owner, roleId: rid })
  for (const key of keys) {
    await testDb.insert(permissions).values({ key, category: 'feedback' }).onConflictDoNothing()
    const row = (await testDb.query.permissions.findFirst({ where: eq(permissions.key, key) }))!
    await testDb.insert(rolePermissions).values({ roleId: rid, permissionId: row.id })
  }
  return rid
}

it('uses stored ownership and live permissions without granting the owner role or any team permission', async () => {
  const actor = await resolveTestFeedbackActor(actorFor(customer))
  expect(actor.testFeedback).toEqual({ ownerPrincipalId: owner, canView: true, canSubmit: true })
  expect(actor.role).toBe('user')
  expect(actor.principalType).toBe('anonymous')
  expect(can(actor, PERMISSIONS.POST_VIEW_PRIVATE)).toBe(false)
  expect(can(actor, PERMISSIONS.SETTINGS_MANAGE)).toBe(false)
  expect((await policyActorFromAuth(auth)).testFeedback).toEqual(actor.testFeedback)
  expect(await getPublicBoardById(privateBoard, actor)).not.toBeNull()
  expect((await listPublicBoardsWithStats(actor)).some((board) => board.id === privateBoard)).toBe(
    true
  )
})

it('advertises and creates a server-tagged private-board test idea with anonymous posting disabled', async () => {
  const capabilities = await runFetchBoardCapabilities(auth)
  expect(capabilities.boards.map((board) => board.id)).toContain(privateBoard)
  expect(capabilities.permissions[privateBoard]).toEqual({ canSubmit: true, canVote: false })
  const created = await runCreatePublicPost(auth, {
    boardId: privateBoard,
    title: 'Acme test idea',
    content: 'A real customer path',
    metadata: { test: 'false', testOwnerPrincipalId: createId('principal') },
  })
  const saved = (await testDb.query.posts.findFirst({ where: eq(posts.id, created.id) }))!
  expect(saved.principalId).toBe(customer)
  expect(saved.widgetMetadata).toMatchObject({ test: 'true', testOwnerPrincipalId: owner })
})

it('reads private-board submission capabilities from the exchanged widget Bearer and revokes them with the owner permission', async () => {
  const token = await mintTestCustomerToken(owner, 'en')
  const exchanged = await consumeTestCustomerToken(token.token)
  expect(exchanged?.principal.id).toBe(customer)
  effects.headers = new Headers({ Authorization: `Bearer ${exchanged!.bearerToken}` })
  const widgetAuth = await getOptionalWidgetAuth()
  expect(widgetAuth?.principal).toEqual({ id: customer, role: 'user', type: 'anonymous' })
  expect(widgetAuth?.permissions).toEqual([])
  const capabilities = await runFetchBoardCapabilities(widgetAuth)
  expect(capabilities.boards.map((board) => board.id)).toContain(privateBoard)
  expect(capabilities.permissions[privateBoard]).toEqual({ canSubmit: true, canVote: false })
  const created = await runCreatePublicPost(widgetAuth!, {
    boardId: privateBoard,
    title: 'Acme idea from the test widget',
    content: 'The real Bearer reads and writes as the test customer.',
  })
  const saved = (await testDb.query.posts.findFirst({ where: eq(posts.id, created.id) }))!
  expect(saved.principalId).toBe(customer)
  expect(saved.widgetMetadata).toMatchObject({ test: 'true', testOwnerPrincipalId: owner })

  await grantOwner([PERMISSIONS.POST_VIEW_PRIVATE])
  const revoked = await runFetchBoardCapabilities(await getOptionalWidgetAuth())
  expect(revoked.permissions[privateBoard]).toEqual({ canSubmit: false, canVote: false })
  await expect(
    runCreatePublicPost((await getOptionalWidgetAuth())!, {
      boardId: privateBoard,
      title: 'Acme denied idea',
      content: '',
    })
  ).rejects.toThrow(/post.create/)

  effects.headers = new Headers({ Cookie: 'better-auth.session_token=teammate-cookie' })
  expect(await getOptionalWidgetAuth()).toBeNull()
  const unauthenticated = await runFetchBoardCapabilities(await getOptionalWidgetAuth())
  expect(unauthenticated.boards.map((board) => board.id)).not.toContain(privateBoard)
  expect(unauthenticated.permissions[publicBoard]).toEqual({ canSubmit: false, canVote: false })
})

it('keeps ordinary anonymous visitors out of private boards and rejects forged test metadata', async () => {
  const uid = createId('user')
  const visitor = createId('principal')
  await testDb
    .insert(user)
    .values({ id: uid, name: 'Acme visitor', email: `you+${uid}@example.com`, isAnonymous: true })
  await testDb
    .insert(principal)
    .values({ id: visitor, userId: uid, type: 'anonymous', role: 'user', createdAt: new Date() })
  const ordinaryAuth: AuthContext = {
    ...auth,
    user: { ...auth.user, id: uid },
    principal: { id: visitor, type: 'anonymous', role: 'user' },
  }
  expect((await resolveTestFeedbackActor(actorFor(visitor))).testFeedback).toBeUndefined()
  expect(await getPublicBoardById(privateBoard, actorFor(visitor))).toBeNull()
  expect((await runFetchBoardCapabilities(ordinaryAuth)).permissions[publicBoard].canSubmit).toBe(
    false
  )
  await expect(
    runCreatePublicPost(ordinaryAuth, {
      boardId: publicBoard,
      title: 'Acme visitor idea',
      content: '',
      metadata: { test: 'true', testOwnerPrincipalId: owner },
    })
  ).rejects.toThrow(/anonymous interaction/i)
})

it('denies test feedback after the owner is demoted or removed', async () => {
  const staleActor = await resolveTestFeedbackActor(actorFor(customer))
  await testDb.update(principal).set({ role: 'user' }).where(eq(principal.id, owner))
  const demoted = await resolveTestFeedbackActor(staleActor)
  expect(demoted.testFeedback).toEqual({
    ownerPrincipalId: owner,
    canView: false,
    canSubmit: false,
  })
  expect(await getPublicBoardById(privateBoard, demoted)).toBeNull()
  await expect(
    runCreatePublicPost(auth, { boardId: privateBoard, title: 'Acme denied idea', content: '' })
  ).rejects.toThrow(/board not found/i)
  await testDb.delete(principal).where(eq(principal.id, owner))
  const removed = await resolveTestFeedbackActor(staleActor)
  expect(removed.testFeedback?.canView).not.toBe(true)
  expect(await getPublicBoardById(privateBoard, removed)).toBeNull()
})

it('uses assignment permissions and distinguishes private-board viewing from posting', async () => {
  await grantOwner([PERMISSIONS.POST_VIEW_PRIVATE])
  const actor = await resolveTestFeedbackActor(actorFor(customer))
  expect(actor.testFeedback).toEqual({ ownerPrincipalId: owner, canView: true, canSubmit: false })
  expect(await getPublicBoardById(privateBoard, actor)).not.toBeNull()
  expect((await runFetchBoardCapabilities(auth)).permissions[privateBoard].canSubmit).toBe(false)
  await expect(
    runCreatePublicPost(auth, { boardId: privateBoard, title: 'Acme denied idea', content: '' })
  ).rejects.toThrow(/permission|submissions/i)
})

it('does not fall back to anonymous posting when a team owner has an empty assigned role', async () => {
  await grantOwner([])
  const actor = await resolveTestFeedbackActor(actorFor(customer))
  expect(actor.testFeedback).toEqual({ ownerPrincipalId: owner, canView: false, canSubmit: false })
  const row = (await testDb.query.settings.findFirst())!
  await testDb
    .update(settings)
    .set({
      portalConfig: JSON.stringify({
        ...DEFAULT_PORTAL_CONFIG,
        features: { ...DEFAULT_PORTAL_CONFIG.features, allowAnonymous: true },
      }),
    })
    .where(eq(settings.id, row.id))
  expect((await runFetchBoardCapabilities(auth)).permissions[publicBoard].canSubmit).toBe(false)
  await expect(
    runCreatePublicPost(auth, { boardId: publicBoard, title: 'Acme denied idea', content: '' })
  ).rejects.toThrow(/permission|submissions/i)
})

it('rechecks owner authority after image processing before inserting the post', async () => {
  effects.beforeRehost = async () => {
    await testDb.update(principal).set({ role: 'user' }).where(eq(principal.id, owner))
  }
  await expect(
    runCreatePublicPost(auth, { boardId: privateBoard, title: 'Acme raced idea', content: '' })
  ).rejects.toThrow(/board|permission|submissions/i)
  expect(
    await testDb.query.posts.findFirst({ where: eq(posts.boardId, privateBoard) })
  ).toBeUndefined()
})

it('rechecks assigned permissions after image processing without trusting the cached owner role', async () => {
  const rid = await grantOwner([PERMISSIONS.POST_VIEW_PRIVATE, PERMISSIONS.POST_CREATE])
  effects.beforeRehost = async () => {
    await testDb.delete(rolePermissions).where(eq(rolePermissions.roleId, rid))
  }
  await expect(
    runCreatePublicPost(auth, { boardId: privateBoard, title: 'Acme revoked idea', content: '' })
  ).rejects.toThrow(/board|permission|submissions/i)
  expect(
    await testDb.query.posts.findFirst({ where: eq(posts.boardId, privateBoard) })
  ).toBeUndefined()
})

it('preserves the anonymous moderation rule when a test customer can submit privately', async () => {
  const privateAccess = access('team')
  privateAccess.moderation.anonPosts = 'on'
  await testDb.update(boards).set({ access: privateAccess }).where(eq(boards.id, privateBoard))
  const created = await runCreatePublicPost(auth, {
    boardId: privateBoard,
    title: 'Acme moderated idea',
    content: '',
  })
  expect(
    (await testDb.query.posts.findFirst({ where: eq(posts.id, created.id) }))?.moderationState
  ).toBe('pending')
})
