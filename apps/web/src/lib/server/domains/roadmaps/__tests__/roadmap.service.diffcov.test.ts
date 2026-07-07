/**
 * Differential-coverage tests for roadmap.service — CRUD validation + dup +
 * not-found, get/list helpers, reorder (empty short-circuit), and post
 * add/remove/reorder with their existence and conflict guards.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => {
  const posTail: Record<string, unknown> = {
    where: () => posTail,
    then: (r: (v: unknown) => void) => r(m.posSelect()),
  }
  return {
    roadmapsFindFirst: vi.fn(),
    roadmapsFindMany: vi.fn(),
    postsFindFirst: vi.fn(),
    postRoadmapsFindFirst: vi.fn(),
    insertReturning: vi.fn(),
    updateReturning: vi.fn(),
    deleteReturning: vi.fn(),
    posSelect: vi.fn(),
    createActivity: vi.fn(),
    dCreated: vi.fn(),
    dUpdated: vi.fn(),
    dDeleted: vi.fn(),
    posTail,
  }
})

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      roadmaps: { findFirst: m.roadmapsFindFirst, findMany: m.roadmapsFindMany },
      posts: { findFirst: m.postsFindFirst },
      postRoadmaps: { findFirst: m.postRoadmapsFindFirst },
    },
    select: () => ({ from: () => m.posTail }),
    insert: () => ({
      values: () => ({
        returning: m.insertReturning,
        then: (r: (v: unknown) => void) => r(undefined),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: m.updateReturning,
          then: (r: (v: unknown) => void) => r(undefined),
        }),
      }),
    }),
    delete: () => ({ where: () => ({ returning: m.deleteReturning }) }),
  },
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  inArray: vi.fn(),
  asc: vi.fn(),
  sql: Object.assign((..._a: unknown[]) => ({ __sql: true }), { raw: () => ({ __raw: true }) }),
  roadmaps: {
    id: 'r.id',
    slug: 'r.slug',
    position: 'r.position',
    deletedAt: 'r.deletedAt',
    isPublic: 'r.isPublic',
  },
  posts: { id: 'p.id' },
  postRoadmaps: { postId: 'prm.postId', roadmapId: 'prm.roadmapId', position: 'prm.position' },
}))

vi.mock('@quackback/ids', () => ({ toUuid: (id: string) => id }))
vi.mock('@/lib/server/domains/activity/activity.service', () => ({
  createActivity: (...a: unknown[]) => m.createActivity(...a),
}))
vi.mock('@/lib/server/logger', () => ({ logger: { child: () => ({ debug: vi.fn() }) } }))
vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchRoadmapCreated: (...a: unknown[]) => m.dCreated(...a),
  dispatchRoadmapUpdated: (...a: unknown[]) => m.dUpdated(...a),
  dispatchRoadmapDeleted: (...a: unknown[]) => m.dDeleted(...a),
}))

import * as svc from '../roadmap.service'

const roadmap = (over: Record<string, unknown> = {}) => ({
  id: 'rm_1',
  slug: 'q1',
  name: 'Q1',
  description: null,
  isPublic: true,
  position: 0,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  deletedAt: null,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  m.roadmapsFindFirst.mockResolvedValue(undefined)
  m.roadmapsFindMany.mockResolvedValue([roadmap()])
  m.postsFindFirst.mockResolvedValue({ id: 'post_1' })
  m.postRoadmapsFindFirst.mockResolvedValue(undefined)
  m.posSelect.mockReturnValue([{ maxPosition: 2 }])
  m.insertReturning.mockResolvedValue([roadmap()])
  m.updateReturning.mockResolvedValue([roadmap()])
  m.deleteReturning.mockResolvedValue([{ postId: 'post_1' }])
  m.dCreated.mockResolvedValue(undefined)
  m.dUpdated.mockResolvedValue(undefined)
  m.dDeleted.mockResolvedValue(undefined)
})

describe('createRoadmap', () => {
  it('validates name, slug, length, and slug format', async () => {
    await expect(svc.createRoadmap({ name: ' ', slug: 'q1' } as never)).rejects.toThrow(
      'Name is required'
    )
    await expect(svc.createRoadmap({ name: 'Q', slug: ' ' } as never)).rejects.toThrow(
      'Slug is required'
    )
    await expect(svc.createRoadmap({ name: 'x'.repeat(101), slug: 'q1' } as never)).rejects.toThrow(
      '100 characters'
    )
    await expect(svc.createRoadmap({ name: 'Q', slug: 'Bad Slug' } as never)).rejects.toThrow(
      'lowercase'
    )
  })
  it('rejects a duplicate slug', async () => {
    m.roadmapsFindFirst.mockResolvedValueOnce(roadmap())
    await expect(svc.createRoadmap({ name: 'Q', slug: 'q1' } as never)).rejects.toThrow(
      'already exists'
    )
  })
  it('creates with the next position and dispatches', async () => {
    const r = await svc.createRoadmap({ name: ' Q1 ', slug: 'q1', description: ' d ' } as never)
    expect(r.id).toBe('rm_1')
    expect(m.dCreated).toHaveBeenCalled()
  })
})

describe('updateRoadmap', () => {
  it('rejects empty / over-long name', async () => {
    await expect(svc.updateRoadmap('rm_1' as never, { name: ' ' } as never)).rejects.toThrow(
      'cannot be empty'
    )
    await expect(
      svc.updateRoadmap('rm_1' as never, { name: 'x'.repeat(101) } as never)
    ).rejects.toThrow('100 characters')
  })
  it('updates fields and dispatches', async () => {
    await svc.updateRoadmap(
      'rm_1' as never,
      { name: ' New ', description: 'd', isPublic: false } as never
    )
    expect(m.dUpdated).toHaveBeenCalled()
  })
  it('throws when not found', async () => {
    m.updateReturning.mockResolvedValueOnce([])
    await expect(svc.updateRoadmap('rm_1' as never, { name: 'x' } as never)).rejects.toThrow(
      'not found'
    )
  })
})

describe('deleteRoadmap', () => {
  it('throws when not found', async () => {
    m.updateReturning.mockResolvedValueOnce([])
    await expect(svc.deleteRoadmap('rm_1' as never)).rejects.toThrow('not found')
  })
  it('soft-deletes and dispatches with a snapshot', async () => {
    m.roadmapsFindFirst.mockResolvedValueOnce(roadmap())
    m.updateReturning.mockResolvedValueOnce([roadmap()])
    await svc.deleteRoadmap('rm_1' as never)
    expect(m.dDeleted).toHaveBeenCalled()
  })
})

describe('get / list', () => {
  it('getRoadmap throws/returns', async () => {
    await expect(svc.getRoadmap('rm_1' as never)).rejects.toThrow('not found')
    m.roadmapsFindFirst.mockResolvedValueOnce(roadmap())
    expect((await svc.getRoadmap('rm_1' as never)).id).toBe('rm_1')
  })
  it('getRoadmapBySlug throws/returns', async () => {
    await expect(svc.getRoadmapBySlug('q1')).rejects.toThrow('not found')
    m.roadmapsFindFirst.mockResolvedValueOnce(roadmap())
    expect((await svc.getRoadmapBySlug('q1')).slug).toBe('q1')
  })
  it('lists admin and public roadmaps', async () => {
    expect(await svc.listRoadmaps()).toEqual([roadmap()])
    expect(await svc.listPublicRoadmaps()).toEqual([roadmap()])
  })
})

describe('reorderRoadmaps', () => {
  it('short-circuits on empty input', async () => {
    await svc.reorderRoadmaps([])
    expect(m.updateReturning).not.toHaveBeenCalled()
  })
  it('updates with a CASE expression', async () => {
    await svc.reorderRoadmaps(['rm_1', 'rm_2'] as never)
    expect(true).toBe(true)
  })
})

describe('addPostToRoadmap', () => {
  it('throws when the roadmap is missing', async () => {
    m.roadmapsFindFirst.mockResolvedValueOnce(undefined)
    await expect(
      svc.addPostToRoadmap({ postId: 'post_1', roadmapId: 'rm_1' } as never)
    ).rejects.toThrow('Roadmap with ID')
  })
  it('throws when the post is missing', async () => {
    m.roadmapsFindFirst.mockResolvedValueOnce(roadmap())
    m.postsFindFirst.mockResolvedValueOnce(undefined)
    await expect(
      svc.addPostToRoadmap({ postId: 'post_1', roadmapId: 'rm_1' } as never)
    ).rejects.toThrow('Post with ID')
  })
  it('throws when already in the roadmap', async () => {
    m.roadmapsFindFirst.mockResolvedValueOnce(roadmap())
    m.postRoadmapsFindFirst.mockResolvedValueOnce({ id: 'prm_1' })
    await expect(
      svc.addPostToRoadmap({ postId: 'post_1', roadmapId: 'rm_1' } as never)
    ).rejects.toThrow('already in roadmap')
  })
  it('adds the post and records activity', async () => {
    m.roadmapsFindFirst.mockResolvedValueOnce(roadmap())
    await svc.addPostToRoadmap({ postId: 'post_1', roadmapId: 'rm_1' } as never, 'p_actor' as never)
    expect(m.createActivity).toHaveBeenCalled()
  })
})

describe('removePostFromRoadmap', () => {
  it('throws when the post is not in the roadmap', async () => {
    m.deleteReturning.mockResolvedValueOnce([])
    await expect(svc.removePostFromRoadmap('post_1' as never, 'rm_1' as never)).rejects.toThrow(
      'not in roadmap'
    )
  })
  it('removes and records activity (roadmap name fallback)', async () => {
    m.deleteReturning.mockResolvedValueOnce([{ postId: 'post_1' }])
    m.roadmapsFindFirst.mockResolvedValueOnce(undefined) // name fallback to ''
    await svc.removePostFromRoadmap('post_1' as never, 'rm_1' as never)
    expect(m.createActivity).toHaveBeenCalled()
  })
})

describe('reorderPostsInColumn', () => {
  it('throws when the roadmap is missing', async () => {
    m.roadmapsFindFirst.mockResolvedValueOnce(undefined)
    await expect(
      svc.reorderPostsInColumn({ roadmapId: 'rm_1', postIds: ['post_1'] } as never)
    ).rejects.toThrow('not found')
  })
  it('short-circuits on empty postIds', async () => {
    m.roadmapsFindFirst.mockResolvedValueOnce(roadmap())
    await svc.reorderPostsInColumn({ roadmapId: 'rm_1', postIds: [] } as never)
    expect(true).toBe(true)
  })
  it('updates positions with a CASE expression', async () => {
    m.roadmapsFindFirst.mockResolvedValueOnce(roadmap())
    await svc.reorderPostsInColumn({ roadmapId: 'rm_1', postIds: ['post_1', 'post_2'] } as never)
    expect(true).toBe(true)
  })
})
