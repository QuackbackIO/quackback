/**
 * Board custom fields: createPost validates submitted values against the
 * board's configured fields (boards.settings.customFields) and stores the
 * cleaned map on the post row's customFieldValues column. A missing required
 * field rejects the submission; unknown keys never reach the row.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardId, PrincipalId, PostStatusId } from '@quackback/ids'
import type { BoardCustomField } from '@/lib/shared/db-types'

const insertedRows: Record<string, unknown[]> = { posts: [], post_votes: [] }

const REQUIRED_TEXT_FIELD: BoardCustomField = {
  key: 'use_case',
  label: 'Use case',
  type: 'text',
  required: true,
}
const OPTIONAL_SELECT_FIELD: BoardCustomField = {
  key: 'impact',
  label: 'Impact',
  type: 'select',
  required: false,
  options: ['low', 'high'],
}
const REQUIRED_CHECKBOX_FIELD: BoardCustomField = {
  key: 'read_docs',
  label: 'I read the docs',
  type: 'checkbox',
  required: true,
}

const LOCKED_ANON_ACCESS = {
  view: 'anonymous',
  vote: 'anonymous',
  comment: 'anonymous',
  submit: 'anonymous',
  segments: { view: [], vote: [], comment: [], submit: [] },
  moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
}

// The fields the mocked board carries; tests swap this per case.
const boardFields: { value: BoardCustomField[] } = { value: [REQUIRED_TEXT_FIELD] }

vi.mock('@/lib/server/db', async () => {
  const { sql: realSql } = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm')

  function chain(label: string) {
    const c: Record<string, unknown> = {}
    c.values = vi.fn((row: unknown) => {
      insertedRows[label] = (insertedRows[label] ?? []).concat(row)
      return c
    })
    c.returning = vi.fn(async () => {
      if (label === 'posts') {
        const last = insertedRows.posts.at(-1) as Record<string, unknown>
        return [
          {
            id: 'post_new',
            boardId: 'board_b',
            statusId: 'post_status_open',
            title: last.title,
            content: last.content,
            principalId: last.principalId,
            customFieldValues: last.customFieldValues ?? null,
            voteCount: 1,
            commentCount: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]
      }
      return []
    })
    return c
  }

  return {
    db: {
      query: {
        boards: {
          findFirst: vi.fn(async () => ({
            id: 'board_b',
            slug: 'feedback',
            name: 'Feedback',
            access: LOCKED_ANON_ACCESS,
            settings: { customFields: boardFields.value },
          })),
        },
        postStatuses: {
          findFirst: vi.fn().mockResolvedValue({ id: 'post_status_open', name: 'Open' }),
        },
      },
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          insert: vi.fn((table: { __name?: string }) => {
            const label =
              table === undefined
                ? 'unknown'
                : (table.__name ?? (table as { [k: string]: unknown }).name ?? 'unknown')
            return chain(typeof label === 'string' ? label : 'posts')
          }),
          select: vi.fn(() => ({
            from: vi.fn(() => ({
              where: vi.fn(() => ({
                for: vi.fn(async () => [{ deletedAt: null, access: LOCKED_ANON_ACCESS }]),
              })),
            })),
          })),
        }
        return fn(tx)
      }),
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
    },
    boards: { id: 'board_id' },
    posts: { __name: 'posts', boardId: 'board_id', deletedAt: 'deleted_at' },
    postStatuses: { id: 'id', slug: 'slug' },
    postTagAssignments: { __name: 'post_tag_assignments' },
    postTags: {},
    postVotes: { __name: 'post_votes' },
    principal: { id: 'id' },
    and: vi.fn((...args: unknown[]) => args),
    eq: vi.fn((a: unknown, b: unknown) => [a, b]),
    inArray: vi.fn((a: unknown, b: unknown) => [a, b]),
    sql: realSql,
  }
})

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: vi.fn().mockResolvedValue({ maxPosts: null }),
}))
vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  enforceCountLimit: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchPostStatusChanged: vi.fn(),
  dispatchPostUpdated: vi.fn(),
  dispatchPostOwnerAssigned: vi.fn(),
  buildEventActor: vi.fn(),
}))
vi.mock('@/lib/server/audit/log', () => ({ recordAuditEvent: vi.fn() }))
vi.mock('@/lib/server/markdown-tiptap', () => ({
  markdownToTiptapJson: vi.fn((content: string) => ({ type: 'doc', content: [content] })),
  projectContentJsonToMarkdown: vi.fn((_json: unknown, fallback: string) => fallback),
}))
vi.mock('@/lib/server/content/rehost-images', () => ({
  rehostExternalImages: vi.fn(async (json: unknown) => json),
}))
vi.mock('@/lib/server/domains/subscriptions/subscription.service', () => ({
  subscribeToPost: vi.fn(),
}))
vi.mock('@/lib/server/domains/activity/activity.service', () => ({ createActivity: vi.fn() }))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getPortalConfig: vi.fn().mockResolvedValue({
    moderationDefault: { requireApproval: 'none' },
  }),
}))
vi.mock('@/lib/server/policy', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/policy')>('@/lib/server/policy')
  return actual
})
vi.mock('../post.announce', () => ({ announcePublishedPost: vi.fn() }))
vi.mock('../sync-post-mentions', () => ({ syncPostMentions: vi.fn() }))
vi.mock('@/lib/server/integrations/message-utils', () => ({
  buildPostUrl: vi.fn(() => 'https://example.test/p'),
}))
vi.mock('@/lib/server/config', () => ({ getBaseUrl: vi.fn(() => 'https://example.test') }))
vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

import { createPost } from '../post.service'

const AUTHOR = { principalId: 'principal_u' as PrincipalId }

function baseInput(customFields?: Record<string, unknown>) {
  return {
    boardId: 'board_b' as BoardId,
    title: 'New post',
    content: 'Body',
    statusId: 'post_status_open' as PostStatusId,
    ...(customFields ? { customFields } : {}),
  }
}

describe('createPost custom fields', () => {
  beforeEach(() => {
    insertedRows.posts = []
    insertedRows.post_votes = []
    boardFields.value = [REQUIRED_TEXT_FIELD]
  })

  it('stores a required field value on the post row', async () => {
    const post = await createPost(baseInput({ use_case: 'Onboarding flow' }), AUTHOR)
    const inserted = insertedRows.posts.at(-1) as { customFieldValues: unknown }
    expect(inserted.customFieldValues).toEqual({ use_case: 'Onboarding flow' })
    expect(post.customFieldValues).toEqual({ use_case: 'Onboarding flow' })
  })

  it('rejects when a required field is missing', async () => {
    await expect(createPost(baseInput(), AUTHOR)).rejects.toThrow(/Use case is required/)
    expect(insertedRows.posts).toHaveLength(0)
  })

  it('rejects when a required field is blank whitespace', async () => {
    await expect(createPost(baseInput({ use_case: '   ' }), AUTHOR)).rejects.toThrow(
      /Use case is required/
    )
  })

  it('drops keys that are not configured on the board', async () => {
    await createPost(baseInput({ use_case: 'Billing', admin_only: 'smuggled' }), AUTHOR)
    const inserted = insertedRows.posts.at(-1) as { customFieldValues: unknown }
    expect(inserted.customFieldValues).toEqual({ use_case: 'Billing' })
  })

  it('validates select values against the field options', async () => {
    boardFields.value = [REQUIRED_TEXT_FIELD, OPTIONAL_SELECT_FIELD]
    await expect(
      createPost(baseInput({ use_case: 'x', impact: 'extreme' }), AUTHOR)
    ).rejects.toThrow(/Impact is not a valid option/)

    await createPost(baseInput({ use_case: 'x', impact: 'high' }), AUTHOR)
    const inserted = insertedRows.posts.at(-1) as { customFieldValues: unknown }
    expect(inserted.customFieldValues).toEqual({ use_case: 'x', impact: 'high' })
  })

  it('a required checkbox must be true', async () => {
    boardFields.value = [REQUIRED_CHECKBOX_FIELD]
    await expect(createPost(baseInput({ read_docs: false }), AUTHOR)).rejects.toThrow(
      /I read the docs is required/
    )
    await createPost(baseInput({ read_docs: true }), AUTHOR)
    const inserted = insertedRows.posts.at(-1) as { customFieldValues: unknown }
    expect(inserted.customFieldValues).toEqual({ read_docs: true })
  })

  it('coerces a number field to a finite number', async () => {
    boardFields.value = [{ key: 'seats', label: 'Seats', type: 'number', required: true }]
    await expect(createPost(baseInput({ seats: 'many' }), AUTHOR)).rejects.toThrow(
      /Seats must be a number/
    )
    await createPost(baseInput({ seats: '42' }), AUTHOR)
    const inserted = insertedRows.posts.at(-1) as { customFieldValues: unknown }
    expect(inserted.customFieldValues).toEqual({ seats: 42 })
  })

  it('stores null when the board configures no fields', async () => {
    boardFields.value = []
    await createPost(baseInput({ anything: 'ignored' }), AUTHOR)
    const inserted = insertedRows.posts.at(-1) as { customFieldValues: unknown }
    expect(inserted.customFieldValues).toBeNull()
  })
})
