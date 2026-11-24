/**
 * A private portal keeps its help center from whoever it turns away, on every
 * read and not just the page: the public help center functions (portal and
 * widget), feedback on an article, and the editors list answer "not found",
 * as the page's sign-in wall does.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

const gate = vi.hoisted(() => ({ granted: true }))
vi.mock('../portal-access', () => ({
  resolvePortalAccessForRequest: async () =>
    gate.granted
      ? { granted: true, reason: 'public' }
      : { granted: false, reason: 'unauthenticated' },
}))
vi.mock('../auth-helpers', () => ({
  requireAuth: vi.fn(),
  getOptionalAuth: vi.fn().mockResolvedValue(null),
  policyActorFromAuth: vi.fn(async () => ({
    principalId: null,
    role: null,
    principalType: 'anonymous',
    segmentIds: new Set(),
  })),
  hasAuthCredentials: () => false,
}))
vi.mock('../widget-auth', () => ({ getOptionalWidgetAuth: vi.fn().mockResolvedValue(null) }))

const reads = vi.hoisted(() => ({
  listPublicCategoriesForLocale: vi.fn(async () => [] as unknown[]),
  recordArticleFeedback: vi.fn(async () => 'feedback_1'),
  listPublicCategoryEditors: vi.fn(async () => []),
}))
vi.mock('@/lib/server/domains/help-center/help-center-locale.query', () => ({
  listPublicCategoriesForLocale: reads.listPublicCategoriesForLocale,
}))
vi.mock('@/lib/server/domains/help-center/help-center.service', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/server/domains/help-center/help-center.service')
  >()),
  recordArticleFeedback: reads.recordArticleFeedback,
  listPublicCategoryEditors: reads.listPublicCategoryEditors,
}))

const { listPublicCategoriesFn, recordArticleFeedbackFn, listPublicCategoryEditorsFn } =
  await import('../help-center')
const { widgetListPublicCategoriesFn } = await import('../widget/help')

type Fn = (args: { data: Record<string, unknown> }) => Promise<unknown>
const lists: Array<[string, () => Promise<unknown>]> = [
  ['listPublicCategoriesFn', () => (listPublicCategoriesFn as unknown as Fn)({ data: {} })],
  [
    'widgetListPublicCategoriesFn',
    () => (widgetListPublicCategoriesFn as unknown as Fn)({ data: {} }),
  ],
  [
    'listPublicCategoryEditorsFn',
    () => (listPublicCategoryEditorsFn as unknown as Fn)({ data: {} }),
  ],
]
const recordFeedback = () =>
  (recordArticleFeedbackFn as unknown as Fn)({
    data: { articleId: 'kb_article_01h455vb4pex5vsknk084sn02q', helpful: true },
  })

beforeEach(() => {
  gate.granted = true
  for (const fn of Object.values(reads)) fn.mockClear()
})

describe('public help center reads on a private portal', () => {
  it.each(lists)('%s answers a caller the portal lets in', async (_, call) => {
    await expect(call()).resolves.toBeDefined()
  })

  it.each(lists)('%s comes back empty to a caller the portal turns away', async (_, call) => {
    gate.granted = false
    expect(await call()).toEqual([])
    for (const fn of Object.values(reads)) expect(fn).not.toHaveBeenCalled()
  })

  it('records article feedback from a caller the portal lets in', async () => {
    await expect(recordFeedback()).resolves.toMatchObject({ success: true })
  })

  it('refuses article feedback from a caller the portal turns away', async () => {
    gate.granted = false
    await expect(recordFeedback()).rejects.toMatchObject({ code: 'HELP_CENTER_NOT_FOUND' })
    expect(reads.recordArticleFeedback).not.toHaveBeenCalled()
  })
})
