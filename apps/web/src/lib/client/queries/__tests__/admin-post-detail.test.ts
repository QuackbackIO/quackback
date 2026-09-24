/**
 * Opening a post in the admin modal fetches the post and the panels beside it
 * (voters, merge suggestions, external links, owner roster) in one request,
 * and seeds each panel's own query from it so the panels render without a
 * request of their own. A panel whose cache is still fresh is not asked for
 * again, and callers that show no panels (the roadmap modal) ask for none.
 */
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostId } from '@quackback/ids'

const mockFetchPostWithDetails = vi.fn()
vi.mock('@/lib/server/functions/posts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/posts')>()),
  fetchPostWithDetails: (...args: unknown[]) => mockFetchPostWithDetails(...args),
}))

const { adminQueries } = await import('../admin')
const { mergeSuggestionQueries } = await import('../signals')
const { postOwnerQueries } = await import('../post-owner')
const { externalLinksKeys } = await import('@/lib/client/hooks/use-post-external-links-query')
const { customerContextQuery } = await import('../customer-context')

const POST = 'post_01h00000000000000000000000' as PostId

const PANELS = {
  customerContext: [] as unknown[],
  voters: [{ principalId: 'principal_v', displayName: 'Voter', createdAt: '2026-01-02T00:00:00Z' }],
  mergeSuggestions: [{ id: 'suggestion_1', createdAt: '2026-01-03T00:00:00Z' }],
  externalLinks: [{ id: 'link_1', integrationType: 'linear' }],
  ownerCandidates: [{ principalId: 'principal_a', name: 'Ada', avatarUrl: null }],
}

function detailPayload(panels?: Partial<typeof PANELS>) {
  return {
    id: POST,
    title: 'A post',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    deletedAt: null,
    eta: null,
    summaryUpdatedAt: null,
    authorEmail: 'author@example.com',
    comments: [],
    pinnedComment: null,
    ...(panels ? { panels } : {}),
  }
}

function requestedPanels(): string[] | undefined {
  const [{ data }] = mockFetchPostWithDetails.mock.calls.at(-1) as [{ data: { panels?: string[] } }]
  return data.panels
}

let client: QueryClient
beforeEach(() => {
  vi.clearAllMocks()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

describe('adminQueries.postDetail with its panels', () => {
  it('asks for every panel on first open and seeds each panel query', async () => {
    mockFetchPostWithDetails.mockResolvedValueOnce(detailPayload(PANELS))

    const detail = await client.fetchQuery(adminQueries.postDetail(POST, { withPanels: true }))

    expect(requestedPanels()?.sort()).toEqual(
      ['customerContext', 'externalLinks', 'mergeSuggestions', 'ownerCandidates', 'voters'].sort()
    )
    expect(client.getQueryData(adminQueries.postVoters(POST).queryKey)).toEqual(PANELS.voters)
    expect(client.getQueryData(mergeSuggestionQueries.forPost(POST).queryKey)).toEqual(
      PANELS.mergeSuggestions
    )
    expect(client.getQueryData(externalLinksKeys.byPost(POST))).toEqual(PANELS.externalLinks)
    expect(client.getQueryData(postOwnerQueries.candidates().queryKey)).toEqual(
      PANELS.ownerCandidates
    )
    // The panels live in their own caches, not inside the detail entry.
    expect(detail).not.toHaveProperty('panels')
    expect(detail.createdAt).toBeInstanceOf(Date)
  })

  it('does not ask again for a panel whose cache is fresh', async () => {
    client.setQueryData(adminQueries.postVoters(POST).queryKey, [])
    client.setQueryData(postOwnerQueries.candidates().queryKey, [])
    mockFetchPostWithDetails.mockResolvedValueOnce(detailPayload({}))

    await client.fetchQuery(adminQueries.postDetail(POST, { withPanels: true }))

    expect(requestedPanels()?.sort()).toEqual([
      'customerContext',
      'externalLinks',
      'mergeSuggestions',
    ])
  })

  it('asks again for a panel whose cache has gone stale', async () => {
    client.setQueryData(adminQueries.postVoters(POST).queryKey, [], {
      updatedAt: Date.now() - 10 * 60_000,
    })
    mockFetchPostWithDetails.mockResolvedValueOnce(detailPayload({}))

    await client.fetchQuery(adminQueries.postDetail(POST, { withPanels: true }))

    expect(requestedPanels()).toContain('voters')
  })

  it('asks for no panels when the caller shows none', async () => {
    mockFetchPostWithDetails.mockResolvedValueOnce(detailPayload())

    await client.fetchQuery(adminQueries.postDetail(POST))

    expect(requestedPanels()).toBeUndefined()
    expect(client.getQueryData(adminQueries.postVoters(POST).queryKey)).toBeUndefined()
  })

  it('leaves a panel the server did not return to fetch on its own', async () => {
    const { ownerCandidates: _withheld, ...withoutRoster } = PANELS
    mockFetchPostWithDetails.mockResolvedValueOnce(detailPayload(withoutRoster))

    await client.fetchQuery(adminQueries.postDetail(POST, { withPanels: true }))

    expect(client.getQueryData(postOwnerQueries.candidates().queryKey)).toBeUndefined()
    expect(client.getQueryData(adminQueries.postVoters(POST).queryKey)).toEqual(PANELS.voters)
  })

  it("seeds the author's customer context when the server answered it", async () => {
    mockFetchPostWithDetails.mockResolvedValueOnce(detailPayload({ customerContext: [] }))

    await client.fetchQuery(adminQueries.postDetail(POST, { withPanels: true }))

    expect(client.getQueryData(customerContextQuery('author@example.com').queryKey)).toEqual([])
  })

  it("does not ask again for a customer context that is fresh for the post's author", async () => {
    mockFetchPostWithDetails.mockResolvedValueOnce(detailPayload({ customerContext: [] }))
    await client.fetchQuery(adminQueries.postDetail(POST, { withPanels: true }))
    await client.invalidateQueries({ queryKey: adminQueries.postDetail(POST).queryKey })
    mockFetchPostWithDetails.mockResolvedValueOnce(detailPayload({}))

    await client.fetchQuery(adminQueries.postDetail(POST, { withPanels: true }))

    expect(requestedPanels()).not.toContain('customerContext')
  })
})
