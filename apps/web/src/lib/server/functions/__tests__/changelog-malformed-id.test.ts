import { describe, expect, it, vi, beforeEach } from 'vitest'
import { generateId } from '@quackback/ids'
import { NotFoundError } from '@/lib/shared/errors'

const mockGetPublicChangelogById = vi.fn()

vi.mock('../auth-helpers', () => ({
  requireAuth: vi.fn(),
  getOptionalAuth: vi.fn().mockResolvedValue(null),
  policyActorFromAuth: vi.fn().mockResolvedValue({}),
}))
vi.mock('../portal-access', () => ({
  resolvePortalAccessForRequest: vi.fn().mockResolvedValue({ granted: true, reason: 'public' }),
}))
vi.mock('@/lib/server/domains/changelog/changelog.audience', () => ({
  isChangelogAudienceGranted: vi.fn().mockResolvedValue(true),
}))
vi.mock('@/lib/server/domains/changelog/changelog.public', () => ({
  getPublicChangelogById: (...a: unknown[]) => mockGetPublicChangelogById(...a),
  listPublicChangelogs: vi.fn(),
}))
vi.mock('@/lib/server/domains/changelog/changelog.service', () => ({}))
vi.mock('@/lib/server/domains/changelog/changelog.query', () => ({}))

const { runGetPublicChangelog } = await import('../changelog')

describe('runGetPublicChangelog id validation', () => {
  beforeEach(() => {
    mockGetPublicChangelogById.mockReset()
    // Mirrors the domain: a malformed id blows up in TypeID parsing, a
    // well-formed one that does not exist is a NotFoundError.
    mockGetPublicChangelogById.mockImplementation(async (id: string) => {
      if (!id.startsWith('changelog_') || id.length !== 36) throw new Error('parse error')
      throw new NotFoundError('CHANGELOG_NOT_FOUND', 'missing')
    })
  })

  it.each(['rss', 'rss.xml', 'changelog_short', 'post_01h455vb4pex5vsknk084sn02q'])(
    'treats malformed id %s as not found without querying',
    async (id) => {
      await expect(runGetPublicChangelog(null, { id })).rejects.toBeInstanceOf(NotFoundError)
      expect(mockGetPublicChangelogById).not.toHaveBeenCalled()
    }
  )

  it('still queries for a well-formed id and surfaces its not-found', async () => {
    const id = generateId('changelog')
    await expect(runGetPublicChangelog(null, { id })).rejects.toBeInstanceOf(NotFoundError)
    expect(mockGetPublicChangelogById).toHaveBeenCalledWith(id, expect.anything())
  })

  it('returns a found entry for a well-formed id', async () => {
    const id = generateId('changelog')
    mockGetPublicChangelogById.mockResolvedValue({ id, title: 't', publishedAt: new Date() })
    const res = (await runGetPublicChangelog(null, { id })) as { id: string }
    expect(res.id).toBe(id)
  })
})
