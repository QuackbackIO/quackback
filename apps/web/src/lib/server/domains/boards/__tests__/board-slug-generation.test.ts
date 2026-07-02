/**
 * Regression for #285: a board whose name slugifies to an empty string
 * (CJK scripts, emoji, etc. — slugify strips them) must still get a
 * non-empty, URL-safe slug. An empty slug violates the column's NOT NULL
 * UNIQUE constraint in spirit and, downstream, crashes slug-keyed
 * <Select.Item> components (Radix forbids an empty-string value) and
 * breaks board routing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  mockedFindFirst: vi.fn(),
  mockedSelect: vi.fn(),
  mockedInsert: vi.fn(),
  mockedUpdate: vi.fn(),
}))

vi.mock('@/lib/server/db', async () => {
  const drizzle = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm')
  return {
    db: {
      query: {
        boards: { findFirst: (...a: unknown[]) => hoisted.mockedFindFirst(...a) },
      },
      select: hoisted.mockedSelect,
      insert: hoisted.mockedInsert,
      update: hoisted.mockedUpdate,
    },
    boards: { id: 'id', slug: 'slug', deletedAt: 'deletedAt' },
    posts: { boardId: 'boardId', deletedAt: 'deletedAt' },
    webhooks: { boardIds: 'boardIds' },
    eq: drizzle.eq,
    and: drizzle.and,
    isNull: drizzle.isNull,
    inArray: drizzle.inArray,
    asc: drizzle.asc,
    sql: drizzle.sql,
    DEFAULT_BOARD_ACCESS: {
      view: 'anonymous',
      vote: 'anonymous',
      comment: 'anonymous',
      submit: 'anonymous',
      segments: { view: [], vote: [], comment: [], submit: [] },
      moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
    },
  }
})

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: vi.fn(),
}))

import { createBoard, updateBoard } from '../board.service'
import { getTierLimits } from '@/lib/server/domains/settings/tier-limits.service'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'
import type { BoardId } from '@quackback/ids'

const BOARD_ID = 'board_01' as unknown as BoardId

const EXISTING_BOARD = {
  id: BOARD_ID,
  name: 'Original',
  slug: 'original',
  description: null,
  access: {},
  settings: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
}

/** Captures the values passed to db.insert().values() */
let capturedInsert: Record<string, unknown> = {}
/** Captures the patch passed to db.update().set() */
let capturedSet: Record<string, unknown> = {}

beforeEach(() => {
  capturedInsert = {}
  capturedSet = {}
  vi.clearAllMocks()

  hoisted.mockedInsert.mockReturnValue({
    values: (vals: Record<string, unknown>) => {
      capturedInsert = vals
      return { returning: () => Promise.resolve([{ ...EXISTING_BOARD, ...vals }]) }
    },
  })
  hoisted.mockedUpdate.mockReturnValue({
    set: (patch: Record<string, unknown>) => {
      capturedSet = patch
      return {
        where: () => ({ returning: () => Promise.resolve([{ ...EXISTING_BOARD, ...patch }]) }),
      }
    },
  })
})

describe('board slug generation for non-Latin names (#285)', () => {
  describe('createBoard', () => {
    beforeEach(() => {
      vi.mocked(getTierLimits).mockResolvedValue(OSS_TIER_LIMITS)
      hoisted.mockedFindFirst.mockResolvedValue(null) // no slug collision
    })

    it('transliterates a Chinese name to a pinyin slug', async () => {
      await expect(createBoard({ name: '反馈' })).resolves.toBeDefined()
      expect(capturedInsert.slug).toBe('fan-kui')
    })

    it('still slugifies Latin names normally', async () => {
      await createBoard({ name: 'Feature Requests' })
      expect(capturedInsert.slug).toBe('feature-requests')
    })

    it('rejects an explicit slug that slugifies to nothing', async () => {
      // The REST schema allows hyphen-only slugs like "---"; an explicit slug
      // that romanizes to nothing is a caller error, not a fallback case.
      await expect(createBoard({ name: 'Roadmap', slug: '---' })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      })
    })

    it('falls back to a generic base for emoji-only names', async () => {
      // Emoji romanize to nothing, so there is no name-derived slug — the
      // generic fallback keeps the board addressable.
      await createBoard({ name: '🎉🎉' })
      expect(capturedInsert.slug).toBe('board')
    })

    it('disambiguates colliding slugs with a counter suffix', async () => {
      // A board already owns "jian-yi"; "jian-yi-1" is free.
      hoisted.mockedFindFirst
        .mockResolvedValueOnce({ id: 'board_other', slug: 'jian-yi' })
        .mockResolvedValueOnce(null)
      await createBoard({ name: '建议' })
      expect(capturedInsert.slug).toBe('jian-yi-1')
    })
  })

  describe('updateBoard', () => {
    beforeEach(() => {
      hoisted.mockedFindFirst.mockResolvedValue(EXISTING_BOARD)
    })

    it('transliterates the slug when renaming a board to a Chinese name', async () => {
      await updateBoard(BOARD_ID, { name: '反馈' })
      expect(capturedSet.slug).toBe('fan-kui')
    })

    it('still auto-updates the slug for Latin renames', async () => {
      hoisted.mockedFindFirst.mockResolvedValueOnce(EXISTING_BOARD) // load existing
      hoisted.mockedFindFirst.mockResolvedValueOnce(null) // slug free
      await updateBoard(BOARD_ID, { name: 'Brand New Name' })
      expect(capturedSet.slug).toBe('brand-new-name')
    })

    it('keeps the existing slug when the derived slug is taken by another board', async () => {
      // existing board owns slug "beta"; "jian-yi" belongs to a different
      // board, so renaming must NOT steal it — keep "beta".
      hoisted.mockedFindFirst
        .mockResolvedValueOnce({ ...EXISTING_BOARD, slug: 'beta' }) // load existing
        .mockResolvedValueOnce({ id: 'board_other', slug: 'jian-yi' }) // derived slug taken elsewhere
      await updateBoard(BOARD_ID, { name: '建议' })
      // No slug write (stays "beta") — and definitely not a duplicate.
      expect(capturedSet.slug).toBeUndefined()
    })
  })
})
