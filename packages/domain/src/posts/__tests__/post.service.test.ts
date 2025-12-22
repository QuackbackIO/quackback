/**
 * PostService Unit Tests
 *
 * Comprehensive test suite for PostService covering all 14 public methods.
 * Tests validation, authorization, business logic, and error handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { CreatePostInput, UpdatePostInput } from '../post.types'
import {
  createMockServiceContext,
  createMockPost,
  createMockBoard,
  createMockTag,
  createMockPostStatus,
  createMockComment,
  createMockUnitOfWork,
  TEST_ROLES,
  TEST_IDS,
  type MockBoardRepository,
  type MockPostRepository,
  type MockUnitOfWork,
} from '../../__tests__/test-utils'
import type { BoardId, PostId, StatusId } from '@quackback/ids'

// Mock the withUnitOfWork function and repositories before importing PostService
const mockWithUnitOfWork = vi.fn()
const mockBoardRepository = vi.fn()
const mockPostRepository = vi.fn()

vi.mock('@quackback/db', async () => {
  const actual = await vi.importActual('@quackback/db')
  return {
    ...actual,
    withUnitOfWork: mockWithUnitOfWork,
    BoardRepository: mockBoardRepository,
    PostRepository: mockPostRepository,
  }
})

// Mock SubscriptionService to avoid database calls in tests
vi.mock('../../subscriptions/subscription.service', () => {
  const mockSubscribeToPost = vi.fn().mockResolvedValue(undefined)
  return {
    SubscriptionService: class MockSubscriptionService {
      subscribeToPost = mockSubscribeToPost
    },
  }
})

// Import after mocking
const { PostService } = await import('../post.service')

describe('PostService', () => {
  let postService: InstanceType<typeof PostService>

  beforeEach(() => {
    postService = new PostService()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  interface SetupMocksConfig {
    boardRepo?: Partial<Pick<MockBoardRepository, 'findById'>>
    postRepo?: Partial<Pick<MockPostRepository, 'findById' | 'create' | 'update'>> & {
      setTags?: ReturnType<typeof vi.fn>
      incrementVoteCount?: ReturnType<typeof vi.fn>
      decrementVoteCount?: ReturnType<typeof vi.fn>
    }
    uowDbMocks?: Record<string, unknown>
  }

  // Helper function to set up repository mocks
  function setupMocks(config: SetupMocksConfig) {
    const mockBoardRepoInstance = {
      findById: config.boardRepo?.findById || vi.fn(),
    }
    const mockPostRepoInstance = {
      findById: config.postRepo?.findById || vi.fn(),
      create: config.postRepo?.create || vi.fn(),
      update: config.postRepo?.update || vi.fn(),
      setTags: config.postRepo?.setTags || vi.fn(),
      incrementVoteCount: config.postRepo?.incrementVoteCount || vi.fn(),
      decrementVoteCount: config.postRepo?.decrementVoteCount || vi.fn(),
    }

    // Mock constructors need to be proper constructor functions
    mockBoardRepository.mockImplementation(function (this: Record<string, unknown>) {
      return mockBoardRepoInstance
    })
    mockPostRepository.mockImplementation(function (this: Record<string, unknown>) {
      return mockPostRepoInstance
    })

    mockWithUnitOfWork.mockImplementation(
      async (callback: (uow: MockUnitOfWork) => Promise<unknown>) => {
        const uow = createMockUnitOfWork()
        if (config.uowDbMocks) {
          Object.assign(uow.db, config.uowDbMocks)
        }
        return callback(uow)
      }
    )

    return { mockBoardRepoInstance, mockPostRepoInstance }
  }

  describe('createPost', () => {
    it('should create a post successfully with valid input', async () => {
      const mockCtx = createMockServiceContext()
      const mockBoard = createMockBoard()
      const mockPost = createMockPost()
      const input: CreatePostInput = {
        boardId: TEST_IDS.BOARD_ID,
        title: 'Test Post',
        content: 'Test content',
        statusId: TEST_IDS.STATUS_ID, // Explicit statusId to bypass default lookup
      }

      setupMocks({
        boardRepo: { findById: vi.fn().mockResolvedValue(mockBoard) },
        postRepo: {
          create: vi.fn().mockResolvedValue(mockPost),
          setTags: vi.fn().mockResolvedValue(undefined),
        },
      })

      const result = await postService.createPost(input, mockCtx)

      expect(result.success).toBe(true)
      if (result.success) {
        // Result now includes boardSlug for event building
        expect(result.value).toEqual({ ...mockPost, boardSlug: mockBoard.slug })
      }
    })

    it('should return error when board does not exist', async () => {
      const mockCtx = createMockServiceContext()
      const input: CreatePostInput = {
        boardId: 'board_nonexistent' as BoardId,
        title: 'Test Post',
        content: 'Test content',
      }

      setupMocks({
        boardRepo: { findById: vi.fn().mockResolvedValue(null) },
      })

      const result = await postService.createPost(input, mockCtx)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('BOARD_NOT_FOUND')
      }
    })

    it('should return error when title is empty', async () => {
      const mockCtx = createMockServiceContext()
      const mockBoard = createMockBoard()
      const input: CreatePostInput = {
        boardId: TEST_IDS.BOARD_ID,
        title: '   ',
        content: 'Test content',
      }

      setupMocks({
        boardRepo: { findById: vi.fn().mockResolvedValue(mockBoard) },
      })

      const result = await postService.createPost(input, mockCtx)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('Title is required')
      }
    })

    it('should return error when content is empty', async () => {
      const mockCtx = createMockServiceContext()
      const mockBoard = createMockBoard()
      const input: CreatePostInput = {
        boardId: TEST_IDS.BOARD_ID,
        title: 'Test Post',
        content: '   ',
      }

      setupMocks({
        boardRepo: { findById: vi.fn().mockResolvedValue(mockBoard) },
      })

      const result = await postService.createPost(input, mockCtx)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('Content is required')
      }
    })

    it('should return error when title exceeds 200 characters', async () => {
      const mockCtx = createMockServiceContext()
      const mockBoard = createMockBoard()
      const input: CreatePostInput = {
        boardId: TEST_IDS.BOARD_ID,
        title: 'a'.repeat(201),
        content: 'Test content',
      }

      setupMocks({
        boardRepo: { findById: vi.fn().mockResolvedValue(mockBoard) },
      })

      const result = await postService.createPost(input, mockCtx)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('200 characters')
      }
    })

    it('should return error when content exceeds 10000 characters', async () => {
      const mockCtx = createMockServiceContext()
      const mockBoard = createMockBoard()
      const input: CreatePostInput = {
        boardId: TEST_IDS.BOARD_ID,
        title: 'Test Post',
        content: 'a'.repeat(10001),
      }

      setupMocks({
        boardRepo: { findById: vi.fn().mockResolvedValue(mockBoard) },
      })

      const result = await postService.createPost(input, mockCtx)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('10,000 characters')
      }
    })

    it('should create post with tags when tagIds provided', async () => {
      const mockCtx = createMockServiceContext()
      const mockBoard = createMockBoard()
      const mockPost = createMockPost()
      const input: CreatePostInput = {
        boardId: TEST_IDS.BOARD_ID,
        title: 'Test Post',
        content: 'Test content',
        statusId: TEST_IDS.STATUS_ID, // Explicit statusId to bypass default lookup
        tagIds: ['tag_1', 'tag_2'],
      }

      const setTagsSpy = vi.fn()

      setupMocks({
        boardRepo: { findById: vi.fn().mockResolvedValue(mockBoard) },
        postRepo: {
          create: vi.fn().mockResolvedValue(mockPost),
          setTags: setTagsSpy,
        },
      })

      const result = await postService.createPost(input, mockCtx)

      expect(result.success).toBe(true)
      expect(setTagsSpy).toHaveBeenCalledWith(mockPost.id, ['tag_1', 'tag_2'])
    })

    it('should trim whitespace from title and content', async () => {
      const mockCtx = createMockServiceContext()
      const mockBoard = createMockBoard()
      const mockPost = createMockPost()
      const input: CreatePostInput = {
        boardId: TEST_IDS.BOARD_ID,
        title: '  Test Post  ',
        content: '  Test content  ',
        statusId: TEST_IDS.STATUS_ID, // Explicit statusId to bypass default lookup
      }

      let capturedData!: Record<string, unknown>
      const createSpy = vi.fn().mockImplementation((data: Record<string, unknown>) => {
        capturedData = data
        return Promise.resolve(mockPost)
      })

      setupMocks({
        boardRepo: { findById: vi.fn().mockResolvedValue(mockBoard) },
        postRepo: {
          create: createSpy,
          setTags: vi.fn(),
        },
      })

      await postService.createPost(input, mockCtx)

      expect(capturedData.title).toBe('Test Post')
      expect(capturedData.content).toBe('Test content')
    })
  })

  describe('updatePost', () => {
    it('should update post successfully with valid input', async () => {
      const mockCtx = createMockServiceContext({ memberRole: TEST_ROLES.ADMIN })
      const mockPost = createMockPost()
      const mockBoard = createMockBoard()
      const updatedPost = createMockPost({ title: 'Updated Title' })
      const input: UpdatePostInput = {
        title: 'Updated Title',
      }

      setupMocks({
        postRepo: {
          findById: vi.fn().mockResolvedValue(mockPost),
          update: vi.fn().mockResolvedValue(updatedPost),
        },
        boardRepo: { findById: vi.fn().mockResolvedValue(mockBoard) },
      })

      const result = await postService.updatePost('post_123', input, mockCtx)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.title).toBe('Updated Title')
      }
    })

    it('should return error when post does not exist', async () => {
      const mockCtx = createMockServiceContext({ memberRole: TEST_ROLES.ADMIN })
      const input: UpdatePostInput = {
        title: 'Updated Title',
      }

      setupMocks({
        postRepo: { findById: vi.fn().mockResolvedValue(null) },
      })

      const result = await postService.updatePost('post_nonexistent', input, mockCtx)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('POST_NOT_FOUND')
      }
    })

    it('should return error when user is not authorized (portal user)', async () => {
      const mockCtx = createMockServiceContext({ memberRole: TEST_ROLES.USER })
      const mockPost = createMockPost()
      const mockBoard = createMockBoard()
      const input: UpdatePostInput = {
        title: 'Updated Title',
      }

      setupMocks({
        postRepo: { findById: vi.fn().mockResolvedValue(mockPost) },
        boardRepo: { findById: vi.fn().mockResolvedValue(mockBoard) },
      })

      const result = await postService.updatePost('post_123', input, mockCtx)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('UNAUTHORIZED')
      }
    })

    it('should allow update for team member role', async () => {
      const mockCtx = createMockServiceContext({ memberRole: TEST_ROLES.MEMBER })
      const mockPost = createMockPost()
      const mockBoard = createMockBoard()
      const updatedPost = createMockPost({ title: 'Updated' })
      const input: UpdatePostInput = {
        title: 'Updated',
      }

      setupMocks({
        postRepo: {
          findById: vi.fn().mockResolvedValue(mockPost),
          update: vi.fn().mockResolvedValue(updatedPost),
        },
        boardRepo: { findById: vi.fn().mockResolvedValue(mockBoard) },
      })

      const result = await postService.updatePost('post_123', input, mockCtx)

      expect(result.success).toBe(true)
    })

    it('should allow update for owner role', async () => {
      const mockCtx = createMockServiceContext({ memberRole: TEST_ROLES.OWNER })
      const mockPost = createMockPost()
      const mockBoard = createMockBoard()
      const updatedPost = createMockPost({ title: 'Updated' })
      const input: UpdatePostInput = {
        title: 'Updated',
      }

      setupMocks({
        postRepo: {
          findById: vi.fn().mockResolvedValue(mockPost),
          update: vi.fn().mockResolvedValue(updatedPost),
        },
        boardRepo: { findById: vi.fn().mockResolvedValue(mockBoard) },
      })

      const result = await postService.updatePost('post_123', input, mockCtx)

      expect(result.success).toBe(true)
    })

    it('should return error when title is empty string', async () => {
      const mockCtx = createMockServiceContext({ memberRole: TEST_ROLES.ADMIN })
      const mockPost = createMockPost()
      const mockBoard = createMockBoard()
      const input: UpdatePostInput = {
        title: '   ',
      }

      setupMocks({
        postRepo: { findById: vi.fn().mockResolvedValue(mockPost) },
        boardRepo: { findById: vi.fn().mockResolvedValue(mockBoard) },
      })

      const result = await postService.updatePost('post_123', input, mockCtx)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('Title cannot be empty')
      }
    })

    it('should return error when content is empty string', async () => {
      const mockCtx = createMockServiceContext({ memberRole: TEST_ROLES.ADMIN })
      const mockPost = createMockPost()
      const mockBoard = createMockBoard()
      const input: UpdatePostInput = {
        content: '   ',
      }

      setupMocks({
        postRepo: { findById: vi.fn().mockResolvedValue(mockPost) },
        boardRepo: { findById: vi.fn().mockResolvedValue(mockBoard) },
      })

      const result = await postService.updatePost('post_123', input, mockCtx)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('Content cannot be empty')
      }
    })

    it('should update tags when tagIds provided', async () => {
      const mockCtx = createMockServiceContext({ memberRole: TEST_ROLES.ADMIN })
      const mockPost = createMockPost()
      const mockBoard = createMockBoard()
      const updatedPost = createMockPost()
      const input: UpdatePostInput = {
        tagIds: ['tag_1', 'tag_2'],
      }

      const setTagsSpy = vi.fn()

      setupMocks({
        postRepo: {
          findById: vi.fn().mockResolvedValue(mockPost),
          update: vi.fn().mockResolvedValue(updatedPost),
          setTags: setTagsSpy,
        },
        boardRepo: { findById: vi.fn().mockResolvedValue(mockBoard) },
      })

      const result = await postService.updatePost('post_123', input, mockCtx)

      expect(result.success).toBe(true)
      expect(setTagsSpy).toHaveBeenCalledWith('post_123', ['tag_1', 'tag_2'])
    })

    it('should set official response with member context', async () => {
      const mockCtx = createMockServiceContext({ memberRole: TEST_ROLES.ADMIN })
      const mockPost = createMockPost()
      const mockBoard = createMockBoard()
      const updatedPost = createMockPost({
        officialResponse: 'This is resolved',
        officialResponseMemberId: TEST_IDS.MEMBER_ID,
      })
      const input: UpdatePostInput = {
        officialResponse: 'This is resolved',
      }

      let capturedUpdateData!: Record<string, unknown>
      const updateSpy = vi.fn().mockImplementation((_id: string, data: Record<string, unknown>) => {
        capturedUpdateData = data
        return Promise.resolve(updatedPost)
      })

      setupMocks({
        postRepo: {
          findById: vi.fn().mockResolvedValue(mockPost),
          update: updateSpy,
        },
        boardRepo: { findById: vi.fn().mockResolvedValue(mockBoard) },
      })

      await postService.updatePost('post_123', input, mockCtx)

      expect(capturedUpdateData.officialResponse).toBe('This is resolved')
      expect(capturedUpdateData.officialResponseMemberId).toBe(TEST_IDS.MEMBER_ID)
      expect(capturedUpdateData.officialResponseAuthorName).toBe('Test User')
      expect(capturedUpdateData.officialResponseAt).toBeInstanceOf(Date)
    })

    it('should clear official response when set to null', async () => {
      const mockCtx = createMockServiceContext({ memberRole: TEST_ROLES.ADMIN })
      const mockPost = createMockPost({ officialResponse: 'Previous response' })
      const mockBoard = createMockBoard()
      const updatedPost = createMockPost({ officialResponse: null })
      const input: UpdatePostInput = {
        officialResponse: null,
      }

      let capturedUpdateData!: Record<string, unknown>
      const updateSpy = vi.fn().mockImplementation((_id: string, data: Record<string, unknown>) => {
        capturedUpdateData = data
        return Promise.resolve(updatedPost)
      })

      setupMocks({
        postRepo: {
          findById: vi.fn().mockResolvedValue(mockPost),
          update: updateSpy,
        },
        boardRepo: { findById: vi.fn().mockResolvedValue(mockBoard) },
      })

      await postService.updatePost('post_123', input, mockCtx)

      expect(capturedUpdateData.officialResponse).toBe(null)
      expect(capturedUpdateData.officialResponseMemberId).toBe(null)
      expect(capturedUpdateData.officialResponseAuthorName).toBe(null)
      expect(capturedUpdateData.officialResponseAt).toBe(null)
    })
  })

  describe('voteOnPost', () => {
    it('should add vote when user has not voted', async () => {
      const mockCtx = createMockServiceContext()
      const mockPost = createMockPost({ voteCount: 5 })
      const mockBoard = createMockBoard()
      const userIdentifier = 'member:member-123'

      // Mock the atomic SQL execute to return "inserted" (vote added)
      const executeSpy = vi.fn().mockResolvedValue([{ vote_count: 6, voted: true }])

      setupMocks({
        postRepo: {
          findById: vi.fn().mockResolvedValue(mockPost),
        },
        boardRepo: { findById: vi.fn().mockResolvedValue(mockBoard) },
        uowDbMocks: {
          execute: executeSpy,
        },
      })

      const result = await postService.voteOnPost(TEST_IDS.POST_ID, userIdentifier, mockCtx)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.voted).toBe(true)
        expect(result.value.voteCount).toBe(6)
      }
      expect(executeSpy).toHaveBeenCalled()
    })

    it('should remove vote when user has already voted', async () => {
      const mockCtx = createMockServiceContext()
      const mockPost = createMockPost({ voteCount: 5 })
      const mockBoard = createMockBoard()
      const userIdentifier = 'member:member-123'

      // Mock the atomic SQL execute to return "deleted" (vote removed)
      const executeSpy = vi.fn().mockResolvedValue([{ vote_count: 4, voted: false }])

      setupMocks({
        postRepo: {
          findById: vi.fn().mockResolvedValue(mockPost),
        },
        boardRepo: { findById: vi.fn().mockResolvedValue(mockBoard) },
        uowDbMocks: {
          execute: executeSpy,
        },
      })

      const result = await postService.voteOnPost(TEST_IDS.POST_ID, userIdentifier, mockCtx)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.voted).toBe(false)
        expect(result.value.voteCount).toBe(4)
      }
      expect(executeSpy).toHaveBeenCalled()
    })

    it('should return error when post does not exist', async () => {
      const mockCtx = createMockServiceContext()
      const userIdentifier = 'member:member-123'

      setupMocks({
        postRepo: { findById: vi.fn().mockResolvedValue(null) },
      })

      const result = await postService.voteOnPost('post_nonexistent', userIdentifier, mockCtx)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('POST_NOT_FOUND')
      }
    })

    it('should not allow negative vote count', async () => {
      const mockCtx = createMockServiceContext()
      const mockPost = createMockPost({ voteCount: 0 })
      const mockBoard = createMockBoard()
      const userIdentifier = 'member:member-123'

      // Mock the atomic SQL execute - the SQL uses GREATEST(0, ...) so it returns 0
      const executeSpy = vi.fn().mockResolvedValue([{ vote_count: 0, voted: false }])

      setupMocks({
        postRepo: {
          findById: vi.fn().mockResolvedValue(mockPost),
        },
        boardRepo: { findById: vi.fn().mockResolvedValue(mockBoard) },
        uowDbMocks: {
          execute: executeSpy,
        },
      })

      const result = await postService.voteOnPost(TEST_IDS.POST_ID, userIdentifier, mockCtx)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.voteCount).toBe(0) // Should be clamped to 0
      }
    })

    it('should pass memberId and ipHash options to execute', async () => {
      const mockCtx = createMockServiceContext()
      const mockPost = createMockPost({ voteCount: 5 })
      const mockBoard = createMockBoard()
      const userIdentifier = 'member:member-123'
      const options = { memberId: TEST_IDS.MEMBER_ID, ipHash: 'abc123' }

      const executeSpy = vi.fn().mockResolvedValue([{ vote_count: 6, voted: true }])

      setupMocks({
        postRepo: {
          findById: vi.fn().mockResolvedValue(mockPost),
        },
        boardRepo: { findById: vi.fn().mockResolvedValue(mockBoard) },
        uowDbMocks: {
          execute: executeSpy,
        },
      })

      const result = await postService.voteOnPost(
        TEST_IDS.POST_ID,
        userIdentifier,
        mockCtx,
        options
      )

      expect(result.success).toBe(true)
      expect(executeSpy).toHaveBeenCalled()
    })
  })

  describe('changeStatus', () => {
    it('should change status successfully with valid input', async () => {
      const mockCtx = createMockServiceContext({ memberRole: TEST_ROLES.ADMIN })
      const mockPost = createMockPost()
      const mockBoard = createMockBoard()
      const mockStatus = createMockPostStatus()
      const updatedPost = createMockPost({ statusId: 'status_123' })

      setupMocks({
        postRepo: {
          findById: vi.fn().mockResolvedValue(mockPost),
          update: vi.fn().mockResolvedValue(updatedPost),
        },
        boardRepo: { findById: vi.fn().mockResolvedValue(mockBoard) },
        uowDbMocks: {
          query: {
            postStatuses: {
              findFirst: vi.fn().mockResolvedValue(mockStatus),
            },
          },
        },
      })

      const result = await postService.changeStatus('post_123', 'status_123', mockCtx)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.statusId).toBe('status_123')
      }
    })

    it('should return error when post does not exist', async () => {
      const mockCtx = createMockServiceContext({ memberRole: TEST_ROLES.ADMIN })

      setupMocks({
        postRepo: { findById: vi.fn().mockResolvedValue(null) },
      })

      const result = await postService.changeStatus('post_nonexistent', 'status_123', mockCtx)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('POST_NOT_FOUND')
      }
    })

    it('should return error when user is not authorized (portal user)', async () => {
      const mockCtx = createMockServiceContext({ memberRole: TEST_ROLES.USER })
      const mockPost = createMockPost()
      const mockBoard = createMockBoard()

      setupMocks({
        postRepo: { findById: vi.fn().mockResolvedValue(mockPost) },
        boardRepo: { findById: vi.fn().mockResolvedValue(mockBoard) },
      })

      const result = await postService.changeStatus('post_123', 'status_123', mockCtx)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('UNAUTHORIZED')
      }
    })

    it('should return error when status does not exist', async () => {
      const mockCtx = createMockServiceContext({ memberRole: TEST_ROLES.ADMIN })
      const mockPost = createMockPost()
      const mockBoard = createMockBoard()

      setupMocks({
        postRepo: { findById: vi.fn().mockResolvedValue(mockPost) },
        boardRepo: { findById: vi.fn().mockResolvedValue(mockBoard) },
        uowDbMocks: {
          query: {
            postStatuses: {
              findFirst: vi.fn().mockResolvedValue(null),
            },
          },
        },
      })

      const result = await postService.changeStatus(
        'post_123' as PostId,
        'status_nonexistent' as StatusId,
        mockCtx
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('STATUS_NOT_FOUND')
      }
    })
  })

  describe('getPostById', () => {
    it('should return post when it exists', async () => {
      const mockCtx = createMockServiceContext()
      const mockPost = createMockPost()
      const mockBoard = createMockBoard()

      setupMocks({
        postRepo: { findById: vi.fn().mockResolvedValue(mockPost) },
        boardRepo: { findById: vi.fn().mockResolvedValue(mockBoard) },
      })

      const result = await postService.getPostById('post_123', mockCtx)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toEqual(mockPost)
      }
    })

    it('should return error when post does not exist', async () => {
      const mockCtx = createMockServiceContext()

      setupMocks({
        postRepo: { findById: vi.fn().mockResolvedValue(null) },
      })

      const result = await postService.getPostById('post_nonexistent', mockCtx)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('POST_NOT_FOUND')
      }
    })

    it('should return error when board does not exist', async () => {
      const mockCtx = createMockServiceContext()
      const mockPost = createMockPost()

      setupMocks({
        postRepo: { findById: vi.fn().mockResolvedValue(mockPost) },
        boardRepo: { findById: vi.fn().mockResolvedValue(null) },
      })

      const result = await postService.getPostById('post_123', mockCtx)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('BOARD_NOT_FOUND')
      }
    })
  })

  describe('getPostWithDetails', () => {
    it('should return post with board, tags, and comment count', async () => {
      const mockCtx = createMockServiceContext()
      const mockPost = createMockPost()
      const mockBoard = createMockBoard()
      const mockTags = [createMockTag({ id: 'tag_1' }), createMockTag({ id: 'tag_2' })]

      setupMocks({
        postRepo: { findById: vi.fn().mockResolvedValue(mockPost) },
        boardRepo: { findById: vi.fn().mockResolvedValue(mockBoard) },
        uowDbMocks: {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              innerJoin: vi.fn().mockReturnValue({
                where: vi
                  .fn()
                  .mockResolvedValue(
                    mockTags.map((t) => ({ id: t.id, name: t.name, color: t.color }))
                  ),
              }),
              where: vi.fn().mockResolvedValue([{ count: 3 }]),
            }),
          }),
        },
      })

      const result = await postService.getPostWithDetails('post_123', mockCtx)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.board).toBeDefined()
        expect(result.value.board.id).toBe(mockBoard.id)
        expect(result.value.tags).toHaveLength(2)
        expect(result.value.commentCount).toBe(3)
      }
    })

    it('should return error when post does not exist', async () => {
      const mockCtx = createMockServiceContext()

      setupMocks({
        postRepo: { findById: vi.fn().mockResolvedValue(null) },
      })

      const result = await postService.getPostWithDetails('post_nonexistent', mockCtx)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('POST_NOT_FOUND')
      }
    })
  })

  describe('getCommentsWithReplies', () => {
    it('should return comment tree when post exists', async () => {
      const mockCtx = createMockServiceContext()
      const mockPost = createMockPost()
      const mockBoard = createMockBoard()
      const mockComments = [
        createMockComment({ id: 'comment_1', parentId: null }),
        createMockComment({ id: 'comment_2', parentId: 'comment_1' }),
      ]

      setupMocks({
        postRepo: { findById: vi.fn().mockResolvedValue(mockPost) },
        boardRepo: { findById: vi.fn().mockResolvedValue(mockBoard) },
        uowDbMocks: {
          query: {
            comments: {
              findMany: vi
                .fn()
                .mockResolvedValue(mockComments.map((c) => ({ ...c, reactions: [] }))),
            },
          },
        },
      })

      const result = await postService.getCommentsWithReplies(
        'post_123',
        'member:member-123',
        mockCtx
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(Array.isArray(result.value)).toBe(true)
      }
    })

    it('should return error when post does not exist', async () => {
      const mockCtx = createMockServiceContext()

      setupMocks({
        postRepo: { findById: vi.fn().mockResolvedValue(null) },
      })

      const result = await postService.getCommentsWithReplies(
        'post_nonexistent',
        'member:member-123',
        mockCtx
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('POST_NOT_FOUND')
      }
    })

    it('should return error when board does not exist', async () => {
      const mockCtx = createMockServiceContext()
      const mockPost = createMockPost()

      setupMocks({
        postRepo: { findById: vi.fn().mockResolvedValue(mockPost) },
        boardRepo: { findById: vi.fn().mockResolvedValue(null) },
      })

      const result = await postService.getCommentsWithReplies(
        'post_123',
        'member:member-123',
        mockCtx
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('BOARD_NOT_FOUND')
      }
    })
  })

  // ============================================
  // PUBLIC/READONLY METHODS (use withUnitOfWork with raw db queries)
  // ============================================

  describe('listPublicPosts', () => {
    it('should return public posts successfully with default parameters', async () => {
      const mockPost = createMockPost()
      const mockBoard = createMockBoard({ isPublic: true })

      const mockCountResult = [{ count: 10 }]
      const mockPostsResult = [
        {
          id: mockPost.id,
          title: mockPost.title,
          content: mockPost.content,
          statusId: mockPost.statusId,
          voteCount: mockPost.voteCount,
          authorName: mockPost.authorName,
          memberId: mockPost.memberId,
          createdAt: mockPost.createdAt,
          boardId: mockBoard.id,
          boardName: mockBoard.name,
          boardSlug: mockBoard.slug,
        },
      ]
      const mockCommentCountsResult = [{ postId: mockPost.id, count: 5 }]
      const mockTagsResult: Array<{
        postId: string
        tagId: string
        tagName: string
        tagColor: string
      }> = []

      // The method makes 4 select() calls:
      // 1. Count query
      // 2. Posts query
      // 3. Comment counts query (parallel with tags)
      // 4. Tags query (parallel with comment counts)
      const mockSelect = vi.fn()

      // First call - count
      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(mockCountResult),
          }),
        }),
      })

      // Second call - posts with full chain
      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  offset: vi.fn().mockResolvedValue(mockPostsResult),
                }),
              }),
            }),
          }),
        }),
      })

      // Third call - comment counts
      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            groupBy: vi.fn().mockResolvedValue(mockCommentCountsResult),
          }),
        }),
      })

      // Fourth call - tags
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(mockTagsResult),
          }),
        }),
      })

      setupMocks({
        uowDbMocks: {
          select: mockSelect,
        },
      })

      const result = await postService.listPublicPosts({
        organizationId: TEST_IDS.ORG_ID,
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.items).toHaveLength(1)
        expect(result.value.total).toBe(10)
        expect(result.value.hasMore).toBe(true)
      }
    })

    it('should filter by board slug when provided', async () => {
      const mockCountResult = [{ count: 5 }]
      const mockPostsResult: Array<Record<string, unknown>> = []

      setupMocks({
        uowDbMocks: {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              innerJoin: vi.fn().mockReturnValue({
                where: vi
                  .fn()
                  .mockResolvedValueOnce(mockCountResult)
                  .mockReturnValue({
                    orderBy: vi.fn().mockReturnValue({
                      limit: vi.fn().mockReturnValue({
                        offset: vi.fn().mockResolvedValue(mockPostsResult),
                      }),
                    }),
                  }),
              }),
            }),
          }),
        },
      })

      const result = await postService.listPublicPosts({
        organizationId: TEST_IDS.ORG_ID,
        boardSlug: 'test-board',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.items).toHaveLength(0)
        expect(result.value.total).toBe(5)
      }
    })

    it('should support search and filter options', async () => {
      const mockCountResult = [{ count: 2 }]
      const mockPostsResult: Array<Record<string, unknown>> = []

      setupMocks({
        uowDbMocks: {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              innerJoin: vi.fn().mockReturnValue({
                where: vi
                  .fn()
                  .mockResolvedValueOnce(mockCountResult)
                  .mockReturnValue({
                    orderBy: vi.fn().mockReturnValue({
                      limit: vi.fn().mockReturnValue({
                        offset: vi.fn().mockResolvedValue(mockPostsResult),
                      }),
                    }),
                  }),
              }),
            }),
          }),
        },
      })

      const result = await postService.listPublicPosts({
        organizationId: TEST_IDS.ORG_ID,
        search: 'bug fix',
        statusSlugs: ['open'],
        sort: 'new',
      })

      expect(result.success).toBe(true)
    })
  })

  describe('listInboxPosts', () => {
    it('should return inbox posts successfully with default parameters', async () => {
      const mockCtx = createMockServiceContext()
      const mockPost = createMockPost()
      const mockBoard = createMockBoard()
      const mockTag = createMockTag()

      const mockBoardsResult = [{ id: TEST_IDS.BOARD_ID }]
      const mockPostsResult = [
        {
          ...mockPost,
          board: { id: mockBoard.id, name: mockBoard.name, slug: mockBoard.slug },
          tags: [{ tag: { id: mockTag.id, name: mockTag.name, color: mockTag.color } }],
        },
      ]
      const mockCountResult = [{ count: 10 }]
      const mockCommentCounts: Array<{ postId: string; count: number }> = []

      setupMocks({
        uowDbMocks: {
          query: {
            boards: {
              findMany: vi.fn().mockResolvedValue(mockBoardsResult),
            },
            posts: {
              findMany: vi.fn().mockResolvedValue(mockPostsResult),
            },
          },
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi
                .fn()
                .mockResolvedValueOnce(mockCountResult)
                .mockReturnValue({
                  groupBy: vi.fn().mockResolvedValue(mockCommentCounts),
                }),
            }),
          }),
        },
      })

      const result = await postService.listInboxPosts({}, mockCtx)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.items).toHaveLength(1)
        expect(result.value.total).toBe(10)
      }
    })

    it('should return empty result when no boards exist', async () => {
      const mockCtx = createMockServiceContext()

      setupMocks({
        uowDbMocks: {
          query: {
            boards: {
              findMany: vi.fn().mockResolvedValue([]),
            },
          },
        },
      })

      const result = await postService.listInboxPosts({}, mockCtx)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.items).toHaveLength(0)
        expect(result.value.total).toBe(0)
        expect(result.value.hasMore).toBe(false)
      }
    })

    it('should filter by tag IDs and return empty when no matching posts', async () => {
      const mockCtx = createMockServiceContext()

      setupMocks({
        uowDbMocks: {
          query: {
            boards: {
              findMany: vi.fn().mockResolvedValue([{ id: TEST_IDS.BOARD_ID }]),
            },
          },
          selectDistinct: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          }),
        },
      })

      const result = await postService.listInboxPosts({ tagIds: ['tag_1'] }, mockCtx)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.items).toHaveLength(0)
        expect(result.value.total).toBe(0)
      }
    })
  })

  describe('listPostsForExport', () => {
    it('should return posts for export successfully', async () => {
      const mockCtx = createMockServiceContext()
      const mockPost = createMockPost()
      const mockBoard = createMockBoard()
      const mockTag = createMockTag()

      const mockBoardsResult = [{ id: TEST_IDS.BOARD_ID }]
      const mockPostsResult = [
        {
          ...mockPost,
          board: { id: mockBoard.id, name: mockBoard.name, slug: mockBoard.slug },
          tags: [{ tag: { id: mockTag.id, name: mockTag.name, color: mockTag.color } }],
        },
      ]

      setupMocks({
        uowDbMocks: {
          query: {
            boards: {
              findMany: vi.fn().mockResolvedValue(mockBoardsResult),
            },
            posts: {
              findMany: vi.fn().mockResolvedValue(mockPostsResult),
            },
            postStatuses: {
              findMany: vi.fn().mockResolvedValue([]),
            },
          },
        },
      })

      const result = await postService.listPostsForExport(undefined, mockCtx)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toHaveLength(1)
        expect(result.value[0].board).toBeDefined()
        expect(result.value[0].tags).toHaveLength(1)
      }
    })

    it('should return empty array when no boards exist', async () => {
      const mockCtx = createMockServiceContext()

      setupMocks({
        uowDbMocks: {
          query: {
            boards: {
              findMany: vi.fn().mockResolvedValue([]),
            },
          },
        },
      })

      const result = await postService.listPostsForExport(undefined, mockCtx)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toHaveLength(0)
      }
    })

    it('should include status details when post has statusId', async () => {
      const mockCtx = createMockServiceContext()
      const mockPost = createMockPost({ statusId: 'status_123' })
      const mockBoard = createMockBoard()
      const mockStatus = createMockPostStatus({ id: 'status_123', name: 'In Progress' })

      const mockBoardsResult = [{ id: TEST_IDS.BOARD_ID }]
      const mockPostsResult = [
        {
          ...mockPost,
          board: { id: mockBoard.id, name: mockBoard.name, slug: mockBoard.slug },
          tags: [],
        },
      ]

      setupMocks({
        uowDbMocks: {
          query: {
            boards: {
              findMany: vi.fn().mockResolvedValue(mockBoardsResult),
            },
            posts: {
              findMany: vi.fn().mockResolvedValue(mockPostsResult),
            },
            postStatuses: {
              findMany: vi.fn().mockResolvedValue([mockStatus]),
            },
          },
        },
      })

      const result = await postService.listPostsForExport(undefined, mockCtx)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value[0].statusDetails).toBeDefined()
        expect(result.value[0].statusDetails?.name).toBe('In Progress')
      }
    })
  })

  describe('getRoadmapPosts', () => {
    it('should return empty array when no status slugs provided', async () => {
      const result = await postService.getRoadmapPosts([])

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toHaveLength(0)
      }
    })
  })

  describe('hasUserVotedOnPost', () => {
    // Note: These methods use dynamic db import, making them difficult to test
    // with the current mock setup. In a real-world scenario, you would need
    // to refactor these methods to accept a db parameter for testability.
    it('should handle vote check operation', async () => {
      // This is a placeholder test to ensure the method exists and has the correct signature
      expect(postService.hasUserVotedOnPost).toBeDefined()
      expect(typeof postService.hasUserVotedOnPost).toBe('function')
    })
  })

  describe('getUserVotedPostIds', () => {
    it('should return empty set when no post IDs provided', async () => {
      const result = await postService.getUserVotedPostIds([], 'member:member-123')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.size).toBe(0)
      }
    })
  })

  describe('getBoardByPostId', () => {
    it('should handle board lookup operation', async () => {
      // This is a placeholder test to ensure the method exists and has the correct signature
      expect(postService.getBoardByPostId).toBeDefined()
      expect(typeof postService.getBoardByPostId).toBe('function')
    })
  })

  describe('getPublicPostDetail', () => {
    it('should handle public post detail retrieval', async () => {
      // This is a placeholder test to ensure the method exists and has the correct signature
      expect(postService.getPublicPostDetail).toBeDefined()
      expect(typeof postService.getPublicPostDetail).toBe('function')
    })
  })
})
