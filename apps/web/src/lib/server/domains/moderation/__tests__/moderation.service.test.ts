/**
 * Direct tests for the moderation service's audit contract — the part the REST
 * path relies on that the server-fn suite (which uses a session actor and no
 * metadata) does not exercise: the machine actor threads through, and the
 * `reason` + caller `metadata` (the acting API key id) merge into one audit row.
 *
 * The guarded transitions / TOCTOU guards / count reconciliation are covered
 * transitively by `functions/__tests__/moderation.test.ts` (which now delegates
 * into this service).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const auditEvents: Array<Record<string, unknown>> = []

// Minimal db mock: findFirst returns a seeded row; the guarded UPDATE returns
// one row (guard satisfied). Condition builders are passthrough sentinels.
const dbState: { post: Record<string, unknown> | undefined } = { post: undefined }

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      posts: { findFirst: vi.fn(async () => dbState.post) },
      postComments: { findFirst: vi.fn(async () => undefined) },
    },
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => (dbState.post ? [{ id: dbState.post.id }] : [])),
        })),
      })),
    })),
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => []) })) })),
  },
  posts: { id: 'posts.id', moderationState: 'posts.moderationState', deletedAt: 'posts.deletedAt' },
  postComments: {},
  boards: {},
  principal: {},
  eq: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
  isNull: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
  exists: vi.fn(() => ({})),
}))

vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: vi.fn(async (e: Record<string, unknown>) => {
    auditEvents.push(e)
  }),
}))
vi.mock('@/lib/server/domains/posts/post.announce', () => ({
  announcePublishedPost: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/server/domains/comments/comment.announce', () => ({
  announcePublishedComment: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/server/logger', () => {
  const child = () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), child })
  return { logger: { child } }
})

import { approvePost, rejectPost } from '../moderation.service'
import { NotFoundError } from '@/lib/shared/errors'

const POST_ID = 'post_01h455vb4pex5vsknk084sn02q' as never
const apiActor = {
  actor: {
    userId: 'user_1' as never,
    role: 'admin',
    type: 'service' as const,
    authMethod: 'api_key' as const,
  },
  headers: new Headers(),
  metadata: { apiKeyId: 'api_key_1' },
}

beforeEach(() => {
  auditEvents.length = 0
  dbState.post = { id: POST_ID, moderationState: 'pending' }
})

describe('approvePost audit', () => {
  it('records the machine actor and merges caller metadata', async () => {
    await approvePost(POST_ID, apiActor)
    const event = auditEvents.find((e) => e.event === 'post.moderation.approved')
    expect(event).toBeDefined()
    expect(event!.actor).toMatchObject({ type: 'service', authMethod: 'api_key' })
    expect(event!.metadata).toEqual({ apiKeyId: 'api_key_1' })
    expect(event!.after).toEqual({ moderationState: 'published' })
  })

  it('throws NotFoundError when the post is missing', async () => {
    dbState.post = undefined
    await expect(approvePost(POST_ID, apiActor)).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('rejectPost audit', () => {
  it('merges reason and caller metadata into one audit row', async () => {
    await rejectPost(POST_ID, 'link spam', apiActor)
    const event = auditEvents.find((e) => e.event === 'post.moderation.rejected')
    expect(event!.metadata).toEqual({ reason: 'link spam', apiKeyId: 'api_key_1' })
  })

  it('stores reason: null when no reason is given (session-path shape preserved)', async () => {
    await rejectPost(POST_ID, undefined, { actor: { type: 'user' }, headers: new Headers() })
    const event = auditEvents.find((e) => e.event === 'post.moderation.rejected')
    expect(event!.metadata).toEqual({ reason: null })
  })
})
