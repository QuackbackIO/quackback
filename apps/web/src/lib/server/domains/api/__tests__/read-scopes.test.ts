/**
 * REST reads of boards, roadmaps, tags, statuses and the status page require
 * the key's read scope and its creator's matching view permission.
 *
 * The real `withApiKeyAuth` runs here (scopes and permissions are its job);
 * only the key lookup, the creator's authority and the services behind each
 * route are stubbed, so a refusal can only come from the gate.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiKey, ApiKeyScope } from '@/lib/server/domains/api-keys'
import { createId, type ApiKeyId, type PrincipalId } from '@quackback/ids'
import { PERMISSIONS, SYSTEM_ROLE_PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { resolveActorPermissions } from '@/lib/server/policy/permissions'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))

const { mockVerify, mockAuthority, services } = vi.hoisted(() => ({
  mockVerify: vi.fn(),
  mockAuthority: vi.fn(),
  services: {
    listBoardsWithDetails: vi.fn(),
    getBoardById: vi.fn(),
    listPublicBoardsWithStats: vi.fn(),
    listRoadmaps: vi.fn(),
    getRoadmap: vi.fn(),
    getRoadmapPosts: vi.fn(),
    listPostTags: vi.fn(),
    getTagById: vi.fn(),
    listStatuses: vi.fn(),
    getStatusById: vi.fn(),
    listStatusComponentGroupsWithComponents: vi.fn(),
    listUngroupedStatusComponents: vi.fn(),
    findComponent: vi.fn(),
    listStatusIncidents: vi.fn(),
    getStatusIncidentById: vi.fn(),
    getStatusPageSnapshot: vi.fn(),
  },
}))

vi.mock('@/lib/server/domains/api-keys/api-key.service', () => ({
  verifyApiKey: (...args: unknown[]) => mockVerify(...args),
}))
vi.mock('@/lib/server/domains/api-keys/api-key-authority', () => ({
  resolveApiKeyAuthority: (...args: unknown[]) => mockAuthority(...args),
}))
vi.mock('@/lib/server/domains/api/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 100 })),
  getClientIp: vi.fn(() => '127.0.0.1'),
  hasRecentApiKeyFailure: vi.fn(async () => false),
  recordApiKeyFailure: vi.fn(async () => {}),
  apiRateLimitRetryAfter: vi.fn(async () => 60),
}))
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: { query: { statusComponents: { findFirst: () => services.findComponent() } } },
}))

const NOW = new Date('2026-11-01T00:00:00Z')
const BOARD = {
  id: createId('board'),
  name: 'Internal',
  slug: 'internal',
  description: null,
  access: {
    view: 'team',
    vote: 'team',
    comment: 'team',
    submit: 'team',
    segments: { view: [], vote: [], comment: [], submit: [] },
  },
  settings: {},
  postCount: 1,
  createdAt: NOW,
  updatedAt: NOW,
}
const ROADMAP = {
  id: createId('roadmap'),
  name: 'Team plan',
  slug: 'team-plan',
  description: null,
  type: 'status',
  baseFilter: null,
  dateSource: null,
  frequency: null,
  visibility: 'team',
  visibleSegmentIds: [],
  position: 0,
  columns: [],
  createdAt: NOW,
}
const TAG = {
  id: createId('post_tag'),
  name: 'Internal',
  color: '#000',
  description: null,
  isPublic: false,
  createdAt: NOW,
}
const STATUS = {
  id: createId('post_status'),
  name: 'Open',
  slug: 'open',
  color: '#000',
  category: 'active',
  position: 0,
  showOnRoadmap: true,
  isDefault: true,
  createdAt: NOW,
}
const COMPONENT = {
  id: createId('status_component'),
  groupId: null,
  name: 'API',
  description: null,
  status: 'operational',
  position: 0,
  showUptime: true,
  segmentIds: [createId('segment')],
}
const INCIDENT = {
  id: createId('status_incident'),
  kind: 'incident',
  title: 'Outage',
  status: 'investigating',
  impact: 'major',
  impactOverride: null,
  scheduledStartAt: null,
  scheduledEndAt: null,
  autoStart: false,
  autoComplete: false,
  startedAt: NOW,
  resolvedAt: null,
  backfilled: false,
  notifiedAt: NOW,
  createdBy: createId('principal'),
  createdAt: NOW,
  updatedAt: NOW,
  affectedComponents: [],
  updates: [],
}

vi.mock('@/lib/server/domains/boards/board.service', () => ({
  listBoardsWithDetails: () => services.listBoardsWithDetails(),
  getBoardById: (id: string) => services.getBoardById(id),
  accessToAudience: () => ({ kind: 'team' }),
}))
vi.mock('@/lib/server/domains/boards/board.public', () => ({
  listPublicBoardsWithStats: (actor: unknown) => services.listPublicBoardsWithStats(actor),
}))
vi.mock('@/lib/server/domains/roadmaps/roadmap.service', () => ({
  listRoadmaps: () => services.listRoadmaps(),
  getRoadmap: (id: string) => services.getRoadmap(id),
}))
vi.mock('@/lib/server/domains/roadmaps/roadmap.query', () => ({
  getRoadmapPosts: (...args: unknown[]) => services.getRoadmapPosts(...args),
}))
vi.mock('@/lib/server/domains/post-tags/post-tag.service', () => ({
  listPostTags: () => services.listPostTags(),
  getTagById: (id: string) => services.getTagById(id),
}))
vi.mock('@/lib/server/domains/statuses/status.service', () => ({
  listStatuses: () => services.listStatuses(),
  getStatusById: (id: string) => services.getStatusById(id),
}))
vi.mock('@/lib/server/domains/status', () => ({
  listStatusComponentGroupsWithComponents: () => services.listStatusComponentGroupsWithComponents(),
  listUngroupedStatusComponents: () => services.listUngroupedStatusComponents(),
  listStatusIncidents: (...args: unknown[]) => services.listStatusIncidents(...args),
  getStatusIncidentById: (id: string) => services.getStatusIncidentById(id),
  getStatusPageSnapshot: (...args: unknown[]) => services.getStatusPageSnapshot(...args),
}))
vi.mock('@/lib/server/domains/settings/settings.status', () => ({
  getStatusSettings: async () => ({ pageDescription: null }),
}))

import { Route as BoardsRoute } from '@/routes/api/v1/boards/index'
import { Route as BoardRoute } from '@/routes/api/v1/boards/$boardId'
import { Route as AppBoardsRoute } from '@/routes/api/v1/apps/boards'
import { Route as RoadmapsRoute } from '@/routes/api/v1/roadmaps/index'
import { Route as RoadmapRoute } from '@/routes/api/v1/roadmaps/$roadmapId'
import { Route as RoadmapColumnsRoute } from '@/routes/api/v1/roadmaps/$roadmapId.columns'
import { Route as RoadmapPostsRoute } from '@/routes/api/v1/roadmaps/$roadmapId.posts'
import { Route as TagsRoute } from '@/routes/api/v1/tags/index'
import { Route as TagRoute } from '@/routes/api/v1/tags/$tagId'
import { Route as StatusesRoute } from '@/routes/api/v1/statuses/index'
import { Route as StatusRoute } from '@/routes/api/v1/statuses/$statusId'
import { Route as IncidentsRoute } from '@/routes/api/v1/status/incidents/index'
import { Route as IncidentRoute } from '@/routes/api/v1/status/incidents/$incidentId'
import { Route as SummaryRoute } from '@/routes/api/v1/status/summary'
import {
  listStatusComponentsHandler,
  getStatusComponentHandler,
} from '@/routes/api/v1/status/-service-handlers'

type GetHandler = (args: { request: Request; params: Record<string, string> }) => Promise<Response>
const get = (route: unknown): GetHandler =>
  (route as { options: { server: { handlers: { GET: GetHandler } } } }).options.server.handlers.GET

function request(path: string): Request {
  return new Request(`https://example.com/api/v1/${path}`, {
    headers: { Authorization: 'Bearer qb_test' },
  })
}

interface ReadCase {
  name: string
  /** The teammate permission the read needs; null for a read open to any teammate. */
  needs: PermissionKey | readonly PermissionKey[] | null
  call: () => Promise<Response>
}

const CASES: ReadCase[] = [
  {
    name: 'GET /boards',
    needs: PERMISSIONS.POST_VIEW_PRIVATE,
    call: () => get(BoardsRoute)({ request: request('boards'), params: {} }),
  },
  {
    name: 'GET /boards/:id',
    needs: PERMISSIONS.POST_VIEW_PRIVATE,
    call: () =>
      get(BoardRoute)({ request: request(`boards/${BOARD.id}`), params: { boardId: BOARD.id } }),
  },
  {
    name: 'GET /apps/boards',
    needs: PERMISSIONS.POST_VIEW_PRIVATE,
    call: () => get(AppBoardsRoute)({ request: request('apps/boards'), params: {} }),
  },
  {
    name: 'GET /roadmaps',
    needs: PERMISSIONS.POST_VIEW_PRIVATE,
    call: () => get(RoadmapsRoute)({ request: request('roadmaps'), params: {} }),
  },
  {
    name: 'GET /roadmaps/:id',
    needs: PERMISSIONS.POST_VIEW_PRIVATE,
    call: () =>
      get(RoadmapRoute)({
        request: request(`roadmaps/${ROADMAP.id}`),
        params: { roadmapId: ROADMAP.id },
      }),
  },
  {
    name: 'GET /roadmaps/:id/columns',
    needs: PERMISSIONS.POST_VIEW_PRIVATE,
    call: () =>
      get(RoadmapColumnsRoute)({
        request: request(`roadmaps/${ROADMAP.id}/columns`),
        params: { roadmapId: ROADMAP.id },
      }),
  },
  {
    name: 'GET /roadmaps/:id/posts',
    needs: PERMISSIONS.POST_VIEW_PRIVATE,
    call: () =>
      get(RoadmapPostsRoute)({
        request: request(`roadmaps/${ROADMAP.id}/posts`),
        params: { roadmapId: ROADMAP.id },
      }),
  },
  {
    name: 'GET /tags',
    needs: PERMISSIONS.TAG_VIEW,
    call: () => get(TagsRoute)({ request: request('tags'), params: {} }),
  },
  {
    name: 'GET /tags/:id',
    needs: PERMISSIONS.TAG_VIEW,
    call: () => get(TagRoute)({ request: request(`tags/${TAG.id}`), params: { tagId: TAG.id } }),
  },
  {
    name: 'GET /statuses',
    needs: PERMISSIONS.STATUS_VIEW,
    call: () => get(StatusesRoute)({ request: request('statuses'), params: {} }),
  },
  {
    name: 'GET /statuses/:id',
    needs: PERMISSIONS.STATUS_VIEW,
    call: () =>
      get(StatusRoute)({
        request: request(`statuses/${STATUS.id}`),
        params: { statusId: STATUS.id },
      }),
  },
  {
    name: 'GET /status/services',
    needs: [PERMISSIONS.STATUS_PAGE_PUBLISH, PERMISSIONS.STATUS_PAGE_MANAGE],
    call: () => listStatusComponentsHandler({ request: request('status/services') }),
  },
  {
    name: 'GET /status/services/:id',
    needs: [PERMISSIONS.STATUS_PAGE_PUBLISH, PERMISSIONS.STATUS_PAGE_MANAGE],
    call: () =>
      getStatusComponentHandler({
        request: request(`status/services/${COMPONENT.id}`),
        id: COMPONENT.id,
        noun: 'service',
      }),
  },
  {
    name: 'GET /status/incidents',
    needs: [PERMISSIONS.STATUS_PAGE_PUBLISH, PERMISSIONS.STATUS_PAGE_MANAGE],
    call: () => get(IncidentsRoute)({ request: request('status/incidents'), params: {} }),
  },
  {
    name: 'GET /status/incidents/:id',
    needs: [PERMISSIONS.STATUS_PAGE_PUBLISH, PERMISSIONS.STATUS_PAGE_MANAGE],
    call: () =>
      get(IncidentRoute)({
        request: request(`status/incidents/${INCIDENT.id}`),
        params: { incidentId: INCIDENT.id },
      }),
  },
  {
    name: 'GET /status/summary',
    needs: null,
    call: () => get(SummaryRoute)({ request: request('status/summary'), params: {} }),
  },
]

const KEY: ApiKey = {
  id: 'apikey_01h455vb4pex5vsknk084sn02q' as ApiKeyId,
  name: 'Integration',
  kind: 'personal',
  keyPrefix: 'qb_test',
  principalId: 'principal_01h455vb4pex5vsknk084sn02s' as PrincipalId,
  createdById: 'principal_01h455vb4pex5vsknk084sn02r' as PrincipalId,
  createdAt: NOW,
  lastUsedAt: null,
  expiresAt: null,
  revokedAt: null,
  scopes: null,
}

/** A key with `scopes` whose creator currently holds `permissions`. */
function useKey(scopes: ApiKeyScope[] | null, permissions: Iterable<PermissionKey>) {
  mockVerify.mockResolvedValue({ ...KEY, scopes })
  mockAuthority.mockResolvedValue({
    principal: { type: 'service', role: 'member' },
    owner: null,
    role: 'member',
    permissions: new Set(permissions),
    scopePrincipalId: null,
  })
}

const needed = (c: ReadCase): readonly PermissionKey[] =>
  c.needs === null ? [] : typeof c.needs === 'string' ? [c.needs] : c.needs

beforeEach(() => {
  vi.clearAllMocks()
  services.listBoardsWithDetails.mockResolvedValue([BOARD])
  services.getBoardById.mockResolvedValue(BOARD)
  services.listPublicBoardsWithStats.mockResolvedValue([BOARD])
  services.listRoadmaps.mockResolvedValue([ROADMAP])
  services.getRoadmap.mockResolvedValue(ROADMAP)
  services.getRoadmapPosts.mockResolvedValue({ items: [], total: 0, hasMore: false })
  services.listPostTags.mockResolvedValue([TAG])
  services.getTagById.mockResolvedValue(TAG)
  services.listStatuses.mockResolvedValue([STATUS])
  services.getStatusById.mockResolvedValue(STATUS)
  services.listStatusComponentGroupsWithComponents.mockResolvedValue([])
  services.listUngroupedStatusComponents.mockResolvedValue([COMPONENT])
  services.findComponent.mockResolvedValue(COMPONENT)
  services.listStatusIncidents.mockResolvedValue({
    items: [INCIDENT],
    nextCursor: null,
    hasMore: false,
  })
  services.getStatusIncidentById.mockResolvedValue(INCIDENT)
  services.getStatusPageSnapshot.mockResolvedValue({
    topLevel: { status: 'operational' },
    ungroupedComponents: [],
    groups: [],
    activeIncidents: [],
  })
})

const anyServiceCalled = () => Object.values(services).some((fn) => fn.mock.calls.length > 0)

describe('REST reads require the read scope', () => {
  it.each(CASES.map((c) => [c.name, c] as const))(
    '%s refuses a key without read:feedback',
    async (_name, c) => {
      useKey(['read:chat', 'write:chat'], resolveActorPermissions('admin'))

      const res = await c.call()

      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.error.code).toBe('FORBIDDEN')
      expect(body.error.message).toContain("'read:feedback'")
      expect(anyServiceCalled()).toBe(false)
    }
  )

  it.each(CASES.map((c) => [c.name, c] as const))(
    '%s serves a read-only feedback key',
    async (_name, c) => {
      useKey(['read:feedback'], resolveActorPermissions('admin'))

      const res = await c.call()

      expect(res.status).toBe(200)
    }
  )
})

describe('REST reads require the matching view permission', () => {
  const gated = CASES.filter((c) => c.needs !== null)

  it.each(gated.map((c) => [c.name, c] as const))(
    '%s refuses a key whose creator lacks the view permission',
    async (_name, c) => {
      const without = new Set(resolveActorPermissions('admin'))
      for (const p of needed(c)) without.delete(p)
      useKey(['read:feedback'], without)

      const res = await c.call()

      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.error.code).toBe('FORBIDDEN')
      expect(body.error.message).toContain(needed(c)[0])
      expect(anyServiceCalled()).toBe(false)
    }
  )

  it.each(gated.map((c) => [c.name, c] as const))(
    '%s serves a contributor key (the narrowest preset that reads feedback)',
    async (_name, c) => {
      useKey(['read:feedback'], SYSTEM_ROLE_PERMISSIONS.contributor)

      const res = await c.call()

      expect(res.status).toBe(200)
    }
  )

  it('GET /status/summary stays open to any teammate key holding read:feedback', async () => {
    useKey(['read:feedback'], [PERMISSIONS.CONVERSATION_VIEW])

    const res = await get(SummaryRoute)({ request: request('status/summary'), params: {} })

    expect(res.status).toBe(200)
  })
})
