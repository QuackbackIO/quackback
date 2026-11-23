/**
 * The public changelog reads ask one question, from the portal and from the
 * widget alike: is the Changelog product on, does the portal let the caller
 * in, and does the changelog audience allow them? The label list answers it
 * too: outside the team, a caller sees only the labels they could see on an
 * entry, and never which segments a label is for.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateId } from '@quackback/ids'
import { NotFoundError } from '@/lib/shared/errors'

vi.mock('@tanstack/react-start', () => ({
  createServerOnlyFn: <T>(fn: T) => fn,
  createServerFn: () => {
    const chain = {
      validator: () => chain,
      handler: (fn: unknown) => fn,
    }
    return chain
  },
}))

const caller = vi.hoisted(() => ({
  role: null as string | null,
  type: 'anonymous' as string,
  segments: [] as string[],
}))
const actorFor = () => ({
  principalId: 'principal_caller',
  role: caller.role,
  principalType: caller.type,
  segmentIds: new Set(caller.segments),
})
vi.mock('../auth-helpers', () => ({
  requireAuth: vi.fn(),
  getOptionalAuth: vi.fn().mockResolvedValue(null),
  policyActorFromAuth: vi.fn(async () => actorFor()),
}))
vi.mock('../widget-auth', () => ({
  getOptionalWidgetAuth: vi.fn().mockResolvedValue(null),
}))

const gate = vi.hoisted(() => ({ portalGranted: true, changelog: true, audienceOk: true }))
vi.mock('../portal-access', () => ({
  resolvePortalAccessForRequest: async () =>
    gate.portalGranted
      ? { granted: true, reason: 'public' }
      : { granted: false, reason: 'unauthenticated' },
}))
vi.mock('@/lib/server/domains/changelog/changelog.audience', () => ({
  isChangelogAudienceGranted: async () => gate.audienceOk,
  isChangelogOpenTo: async () => gate.changelog && gate.audienceOk,
}))

const ENTRY = generateId('changelog')
const mockGetById = vi.hoisted(() => vi.fn())
const mockList = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/domains/changelog/changelog.public', () => ({
  getPublicChangelogById: (...a: unknown[]) => mockGetById(...a),
  listPublicChangelogs: (...a: unknown[]) => mockList(...a),
}))
vi.mock('@/lib/server/domains/changelog/changelog.service', () => ({}))
vi.mock('@/lib/server/domains/changelog/changelog.query', () => ({}))

const OPEN_LABEL = { id: 'changelog_category_open', name: 'Fixes', segmentIds: [] as string[] }
const VIP_LABEL = { id: 'changelog_category_vip', name: 'VIP', segmentIds: ['segment_vip'] }
vi.mock('@/lib/server/domains/changelog/changelog-category.service', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/server/domains/changelog/changelog-category.service')
  >()),
  listChangelogCategories: async () => [OPEN_LABEL, VIP_LABEL],
}))

const { listPublicChangelogsFn, getPublicChangelogFn } = await import('../changelog')
const { widgetListPublicChangelogsFn, widgetGetPublicChangelogFn } =
  await import('../widget/changelog')
const { listChangelogCategoriesFn } = await import('../changelog-categories')

type ListFn = (args: { data: { limit?: number } }) => Promise<{ items: unknown[] }>
type GetFn = (args: { data: { id: string } }) => Promise<{ id: string }>
type LabelsFn = () => Promise<Array<{ id: string; segmentIds: string[] }>>
const portalList = listPublicChangelogsFn as unknown as ListFn
const portalGet = getPublicChangelogFn as unknown as GetFn
const widgetList = widgetListPublicChangelogsFn as unknown as ListFn
const widgetGet = widgetGetPublicChangelogFn as unknown as GetFn
const labels = listChangelogCategoriesFn as unknown as LabelsFn

beforeEach(() => {
  caller.role = null
  caller.type = 'anonymous'
  caller.segments = []
  gate.portalGranted = true
  gate.changelog = true
  gate.audienceOk = true
  mockList.mockReset().mockResolvedValue({
    items: [{ id: ENTRY, publishedAt: new Date() }],
    nextCursor: null,
    hasMore: false,
  })
  mockGetById.mockReset().mockResolvedValue({ id: ENTRY, publishedAt: new Date() })
})

describe.each([
  ['portal', portalList, portalGet],
  ['widget', widgetList, widgetGet],
])('%s changelog reads', (_, list, get) => {
  it('serve published entries when every gate is open', async () => {
    expect((await list({ data: {} })).items).toHaveLength(1)
    expect((await get({ data: { id: ENTRY } })).id).toBe(ENTRY)
  })

  it.each([
    ['the Changelog product is off', () => (gate.changelog = false)],
    ['the portal turns the caller away', () => (gate.portalGranted = false)],
    ['the audience leaves the caller out', () => (gate.audienceOk = false)],
  ])('serve nothing when %s', async (__, close) => {
    close()
    expect((await list({ data: {} })).items).toEqual([])
    await expect(get({ data: { id: ENTRY } })).rejects.toBeInstanceOf(NotFoundError)
    expect(mockList).not.toHaveBeenCalled()
    expect(mockGetById).not.toHaveBeenCalled()
  })
})

describe('listChangelogCategoriesFn', () => {
  it('gives a visitor only the labels they could see, without who they are for', async () => {
    const rows = await labels()
    expect(rows.map((r) => r.id)).toEqual([OPEN_LABEL.id])
    expect(JSON.stringify(rows)).not.toContain('segment_vip')
  })

  it('gives a segment member the label gated to their segment, still without its segments', async () => {
    caller.type = 'user'
    caller.role = 'user'
    caller.segments = ['segment_vip']
    const rows = await labels()
    expect(rows.map((r) => r.id)).toEqual([OPEN_LABEL.id, VIP_LABEL.id])
    expect(JSON.stringify(rows)).not.toContain('segment_vip')
  })

  it.each([
    ['the Changelog product is off', () => (gate.changelog = false)],
    ['the portal turns the caller away', () => (gate.portalGranted = false)],
  ])('gives a visitor nothing when %s', async (_, close) => {
    close()
    expect(await labels()).toEqual([])
  })

  it('gives a teammate every label with its segments, even with the product off', async () => {
    caller.type = 'user'
    caller.role = 'member'
    gate.changelog = false
    expect(await labels()).toEqual([OPEN_LABEL, VIP_LABEL])
  })
})
