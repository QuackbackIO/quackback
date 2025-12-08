/**
 * Test utilities for domain service testing
 *
 * Provides mock factories and test helpers for isolating service logic
 * from database dependencies.
 */

import { vi, type Mock } from 'vitest'
import type { ServiceContext } from '../shared/service-context'

// ============================================
// TEST CONSTANTS
// ============================================

/**
 * Member roles for authorization testing
 */
export const TEST_ROLES = {
  OWNER: 'owner' as const,
  ADMIN: 'admin' as const,
  MEMBER: 'member' as const,
  USER: 'user' as const, // Portal user (limited access)
}

export type TestRole = (typeof TEST_ROLES)[keyof typeof TEST_ROLES]

// ============================================
// MOCK ENTITY FACTORIES
// ============================================

/**
 * Create a mock ServiceContext for testing
 */
export function createMockServiceContext(overrides?: Partial<ServiceContext>): ServiceContext {
  return {
    organizationId: 'org-123',
    userId: 'user-123',
    memberId: 'member-123',
    memberRole: 'admin',
    userName: 'Test User',
    userEmail: 'test@example.com',
    ...overrides,
  }
}

/**
 * Create a mock Post for testing
 */
export function createMockPost(overrides?: Record<string, unknown>) {
  return {
    id: 'post-123',
    boardId: 'board-123',
    title: 'Test Post',
    content: 'Test content',
    contentJson: null,
    status: 'open',
    statusId: null,
    voteCount: 0,
    memberId: 'member-123',
    authorId: null,
    authorName: 'Test User',
    authorEmail: 'test@example.com',
    ownerId: null,
    ownerMemberId: null,
    estimated: null,
    officialResponse: null,
    officialResponseMemberId: null,
    officialResponseAuthorId: null,
    officialResponseAuthorName: null,
    officialResponseAt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }
}

/**
 * Create a mock Board for testing
 */
export function createMockBoard(overrides?: Record<string, unknown>) {
  return {
    id: 'board-123',
    organizationId: 'org-123',
    name: 'Test Board',
    slug: 'test-board',
    description: null,
    isPublic: true,
    settings: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }
}

/**
 * Create a mock Tag for testing
 */
export function createMockTag(overrides?: Record<string, unknown>) {
  return {
    id: 'tag-123',
    organizationId: 'org-123',
    name: 'Test Tag',
    color: '#3b82f6',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }
}

/**
 * Create a mock Comment for testing
 */
export function createMockComment(overrides?: Record<string, unknown>) {
  return {
    id: 'comment-123',
    postId: 'post-123',
    parentId: null,
    memberId: 'member-123',
    authorId: null,
    authorName: 'Test User',
    authorEmail: 'test@example.com',
    content: 'Test comment',
    isTeamMember: true,
    createdAt: new Date('2024-01-01'),
    ...overrides,
  }
}

/**
 * Create a mock Vote for testing
 */
export function createMockVote(overrides?: Record<string, unknown>) {
  return {
    id: 'vote-123',
    postId: 'post-123',
    userIdentifier: 'member:member-123',
    createdAt: new Date('2024-01-01'),
    ...overrides,
  }
}

/**
 * Create a mock PostStatus for testing
 */
export function createMockPostStatus(overrides?: Record<string, unknown>) {
  return {
    id: 'status-123',
    organizationId: 'org-123',
    name: 'In Progress',
    slug: 'in-progress',
    color: '#3b82f6',
    category: 'active',
    position: 1,
    isDefault: false,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }
}

/**
 * Create a mock Member for testing
 */
export function createMockMember(overrides?: Record<string, unknown>) {
  return {
    id: 'member-123',
    userId: 'user-123',
    organizationId: 'org-123',
    role: 'admin',
    createdAt: new Date('2024-01-01'),
    ...overrides,
  }
}

/**
 * Create a mock Organization for testing
 */
export function createMockOrganization(overrides?: Record<string, unknown>) {
  return {
    id: 'org-123',
    name: 'Test Organization',
    slug: 'test-org',
    logo: null,
    metadata: null,
    createdAt: new Date('2024-01-01'),
    ...overrides,
  }
}

// ============================================
// MOCK REPOSITORY FACTORIES
// ============================================

export interface MockTagRepository {
  findById: Mock
  findAll: Mock
  findByBoardId: Mock
  create: Mock
  update: Mock
  delete: Mock
}

export function createMockTagRepository(): MockTagRepository {
  return {
    findById: vi.fn(),
    findAll: vi.fn().mockResolvedValue([]),
    findByBoardId: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  }
}

export interface MockBoardRepository {
  findById: Mock
  findBySlug: Mock
  findAll: Mock
  findWithPostCount: Mock
  create: Mock
  update: Mock
  delete: Mock
  generateUniqueSlug: Mock
}

export function createMockBoardRepository(): MockBoardRepository {
  return {
    findById: vi.fn(),
    findBySlug: vi.fn(),
    findAll: vi.fn().mockResolvedValue([]),
    findWithPostCount: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    generateUniqueSlug: vi.fn(),
  }
}

export interface MockPostRepository {
  findById: Mock
  findByBoardId: Mock
  findMany: Mock
  create: Mock
  update: Mock
  delete: Mock
  incrementVoteCount: Mock
  decrementVoteCount: Mock
}

export function createMockPostRepository(): MockPostRepository {
  return {
    findById: vi.fn(),
    findByBoardId: vi.fn().mockResolvedValue([]),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    incrementVoteCount: vi.fn(),
    decrementVoteCount: vi.fn(),
  }
}

export interface MockVoteRepository {
  findByPostAndUser: Mock
  findByPostIds: Mock
  create: Mock
  delete: Mock
}

export function createMockVoteRepository(): MockVoteRepository {
  return {
    findByPostAndUser: vi.fn(),
    findByPostIds: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    delete: vi.fn(),
  }
}

export interface MockStatusRepository {
  findById: Mock
  findBySlug: Mock
  findAll: Mock
  findDefault: Mock
  create: Mock
  update: Mock
  delete: Mock
  reorder: Mock
}

export function createMockStatusRepository(): MockStatusRepository {
  return {
    findById: vi.fn(),
    findBySlug: vi.fn(),
    findAll: vi.fn().mockResolvedValue([]),
    findDefault: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    reorder: vi.fn(),
  }
}

export interface MockCommentRepository {
  findById: Mock
  findByPostId: Mock
  create: Mock
  update: Mock
  delete: Mock
  findReactionsByCommentIds: Mock
  addReaction: Mock
  removeReaction: Mock
  findReaction: Mock
}

export function createMockCommentRepository(): MockCommentRepository {
  return {
    findById: vi.fn(),
    findByPostId: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findReactionsByCommentIds: vi.fn().mockResolvedValue([]),
    addReaction: vi.fn(),
    removeReaction: vi.fn(),
    findReaction: vi.fn(),
  }
}

export interface MockMemberRepository {
  findById: Mock
  findByUserAndOrg: Mock
  findByOrganization: Mock
  countByOrganization: Mock
}

export function createMockMemberRepository(): MockMemberRepository {
  return {
    findById: vi.fn(),
    findByUserAndOrg: vi.fn(),
    findByOrganization: vi.fn().mockResolvedValue([]),
    countByOrganization: vi.fn().mockResolvedValue(0),
  }
}

// ============================================
// MOCK UnitOfWork HELPER
// ============================================

/**
 * Mock query methods for a table
 */
interface MockQueryTable {
  findFirst: Mock
  findMany: Mock
}

/**
 * Mock UnitOfWork structure for testing
 */
export interface MockUnitOfWork {
  db: {
    query: {
      posts: MockQueryTable
      boards: MockQueryTable
      tags: MockQueryTable
      votes: MockQueryTable
      comments: MockQueryTable
      postStatuses: MockQueryTable
      member: MockQueryTable
      organization: MockQueryTable
    }
    insert: Mock
    update: Mock
    delete: Mock
    select: Mock
    execute: Mock
  }
}

/**
 * Creates a mock UnitOfWork object for testing.
 * Returns an object with a mock db property.
 */
export function createMockUnitOfWork(): MockUnitOfWork {
  return {
    db: {
      query: {
        posts: { findFirst: vi.fn(), findMany: vi.fn() },
        boards: { findFirst: vi.fn(), findMany: vi.fn() },
        tags: { findFirst: vi.fn(), findMany: vi.fn() },
        votes: { findFirst: vi.fn(), findMany: vi.fn() },
        comments: { findFirst: vi.fn(), findMany: vi.fn() },
        postStatuses: { findFirst: vi.fn(), findMany: vi.fn() },
        member: { findFirst: vi.fn(), findMany: vi.fn() },
        organization: { findFirst: vi.fn(), findMany: vi.fn() },
      },
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
      }),
      execute: vi.fn(),
    },
  }
}

// ============================================
// MOCK withUnitOfWork HELPER
// ============================================

/**
 * Creates a mock for withUnitOfWork that executes the callback
 * with provided mock repositories.
 *
 * Usage:
 * ```ts
 * const mockTagRepo = createMockTagRepository()
 * const mockWithUoW = createMockWithUnitOfWork({
 *   TagRepository: mockTagRepo,
 * })
 * vi.mocked(withUnitOfWork).mockImplementation(mockWithUoW)
 * ```
 */
export function createMockWithUnitOfWork(repoMocks: Record<string, unknown> = {}) {
  return async <T>(
    _organizationId: string,
    callback: (uow: { db: unknown }) => Promise<T>
  ): Promise<T> => {
    // Create a minimal mock db object
    const mockDb = {
      query: {
        posts: { findFirst: vi.fn(), findMany: vi.fn() },
        boards: { findFirst: vi.fn(), findMany: vi.fn() },
        tags: { findFirst: vi.fn(), findMany: vi.fn() },
        votes: { findFirst: vi.fn(), findMany: vi.fn() },
        comments: { findFirst: vi.fn(), findMany: vi.fn() },
        postStatuses: { findFirst: vi.fn(), findMany: vi.fn() },
        member: { findFirst: vi.fn(), findMany: vi.fn() },
        organization: { findFirst: vi.fn(), findMany: vi.fn() },
      },
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
      }),
      execute: vi.fn(),
      ...repoMocks,
    }

    return callback({ db: mockDb })
  }
}

// ============================================
// RESULT HELPERS
// ============================================

/**
 * Helper to check if a Result is successful
 */
export function isOk<T, E>(result: {
  success: boolean
  data?: T
  error?: E
}): result is { success: true; data: T } {
  return result.success === true
}

/**
 * Helper to check if a Result is an error
 */
export function isErr<T, E>(result: {
  success: boolean
  data?: T
  error?: E
}): result is { success: false; error: E } {
  return result.success === false
}
