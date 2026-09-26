/**
 * The admin post detail loads the side panels its caller asks for with the
 * post. Pins that only the requested panels are read, that each comes back in
 * the same shape its own server function returns (the client seeds those
 * queries with it), and that the owner roster stays behind post.set_owner.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostId, PrincipalId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'

const mockGetPostVoters = vi.fn()
vi.mock('../post.voters', () => ({
  getPostVoters: (...args: unknown[]) => mockGetPostVoters(...args),
}))

const mockGetPostExternalLinks = vi.fn()
vi.mock('../post.cascade-delete', () => ({
  getPostExternalLinks: (...args: unknown[]) => mockGetPostExternalLinks(...args),
}))

const mockGetPendingSuggestions = vi.fn()
vi.mock('@/lib/server/domains/merge-suggestions/merge-suggestion.service', () => ({
  getPendingSuggestionsForPost: (...args: unknown[]) => mockGetPendingSuggestions(...args),
}))

const mockListTeamMembers = vi.fn()
vi.mock('@/lib/server/domains/principals/principal.service', () => ({
  listTeamMembers: () => mockListTeamMembers(),
}))

const mockHasCustomerContextProvider = vi.fn()
vi.mock('@/lib/server/integrations/context', () => ({
  hasCustomerContextProvider: () => mockHasCustomerContextProvider(),
}))

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
}))

const { loadAdminPostPanels } = await import('../post.admin-panels')

const POST = 'post_01h00000000000000000000000' as PostId
const VOTED_AT = new Date('2026-01-02T03:04:05.000Z')
const SUGGESTED_AT = new Date('2026-02-03T04:05:06.000Z')
const ALL = ['voters', 'mergeSuggestions', 'externalLinks', 'ownerCandidates'] as const

beforeEach(() => {
  vi.resetAllMocks()
  mockGetPostVoters.mockResolvedValue([
    { principalId: 'principal_v', displayName: 'Voter', createdAt: VOTED_AT },
  ])
  mockGetPendingSuggestions.mockResolvedValue([
    { id: 'suggestion_1', sourcePostId: POST, createdAt: SUGGESTED_AT },
  ])
  mockGetPostExternalLinks.mockResolvedValue([{ id: 'link_1', integrationType: 'linear' }])
  mockHasCustomerContextProvider.mockResolvedValue(false)
  mockListTeamMembers.mockResolvedValue([
    { id: 'principal_a' as PrincipalId, name: 'Ada', email: 'ada@x.io', image: 'https://x/a.png' },
    { id: 'principal_b' as PrincipalId, name: null, email: 'b@x.io', image: null },
  ])
})

describe('loadAdminPostPanels', () => {
  it('reads nothing when nothing is asked for', async () => {
    const panels = await loadAdminPostPanels(POST, [], [PERMISSIONS.POST_SET_OWNER])

    expect(panels).toEqual({})
    expect(mockGetPostVoters).not.toHaveBeenCalled()
    expect(mockGetPendingSuggestions).not.toHaveBeenCalled()
    expect(mockGetPostExternalLinks).not.toHaveBeenCalled()
    expect(mockListTeamMembers).not.toHaveBeenCalled()
  })

  it('reads only the panels asked for', async () => {
    const panels = await loadAdminPostPanels(POST, ['voters'], [PERMISSIONS.POST_SET_OWNER])

    expect(Object.keys(panels)).toEqual(['voters'])
    expect(mockGetPostVoters).toHaveBeenCalledWith(POST)
    expect(mockGetPendingSuggestions).not.toHaveBeenCalled()
    expect(mockGetPostExternalLinks).not.toHaveBeenCalled()
    expect(mockListTeamMembers).not.toHaveBeenCalled()
  })

  it('returns each panel in the shape its own server function returns', async () => {
    const panels = await loadAdminPostPanels(POST, ALL, [PERMISSIONS.POST_SET_OWNER])

    expect(panels).toEqual({
      voters: [
        { principalId: 'principal_v', displayName: 'Voter', createdAt: '2026-01-02T03:04:05.000Z' },
      ],
      mergeSuggestions: [
        { id: 'suggestion_1', sourcePostId: POST, createdAt: '2026-02-03T04:05:06.000Z' },
      ],
      externalLinks: [{ id: 'link_1', integrationType: 'linear' }],
      ownerCandidates: [
        { principalId: 'principal_a', name: 'Ada', avatarUrl: 'https://x/a.png' },
        { principalId: 'principal_b', name: 'b@x.io', avatarUrl: null },
      ],
    })
  })

  it('leaves the owner roster out without post.set_owner', async () => {
    const panels = await loadAdminPostPanels(POST, ALL, [PERMISSIONS.POST_VIEW_PRIVATE])

    expect(panels).not.toHaveProperty('ownerCandidates')
    expect(mockListTeamMembers).not.toHaveBeenCalled()
    expect(panels.voters).toHaveLength(1)
  })

  it('answers no merge suggestions when they cannot be read, like the panel fn', async () => {
    mockGetPendingSuggestions.mockRejectedValueOnce(new Error('boom'))

    const panels = await loadAdminPostPanels(POST, ['mergeSuggestions'], [])

    expect(panels).toEqual({ mergeSuggestions: [] })
  })

  describe('customer context', () => {
    it('answers no cards when no connected integration can look a customer up', async () => {
      const panels = await loadAdminPostPanels(
        POST,
        ['customerContext'],
        [PERMISSIONS.INTEGRATION_VIEW]
      )

      expect(panels).toEqual({ customerContext: [] })
    })

    it('leaves the lookup to its own request when an integration can answer it', async () => {
      mockHasCustomerContextProvider.mockResolvedValueOnce(true)

      const panels = await loadAdminPostPanels(
        POST,
        ['customerContext'],
        [PERMISSIONS.INTEGRATION_VIEW]
      )

      expect(panels).not.toHaveProperty('customerContext')
    })

    it('answers no cards without integration.view, whose lookup would be refused', async () => {
      mockHasCustomerContextProvider.mockResolvedValueOnce(true)

      const panels = await loadAdminPostPanels(POST, ['customerContext'], [])

      expect(panels).toEqual({ customerContext: [] })
      expect(mockHasCustomerContextProvider).not.toHaveBeenCalled()
    })
  })
})
