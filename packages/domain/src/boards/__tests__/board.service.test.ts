import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { BoardService } from '../board.service'
import type { CreateBoardInput, UpdateBoardInput } from '../board.types'
import type { ServiceContext } from '../../shared/service-context'
import type { Board, BoardSettings, NewBoard } from '@quackback/db/types'
import type { UnitOfWork } from '@quackback/db'
import type { BoardId } from '@quackback/ids'
import { createMockBoard } from '../../__tests__/test-utils'

/** Mocked BoardRepository interface with the methods used in tests */
interface MockBoardRepository {
  findById: Mock<(id: string) => Promise<Board | null>>
  findBySlug: Mock<(slug: string) => Promise<Board | null>>
  findAll: Mock<(options?: { limit?: number; offset?: number }) => Promise<Board[]>>
  create: Mock<(data: NewBoard) => Promise<Board>>
  update: Mock<(id: string, data: Partial<Board>) => Promise<Board | null>>
  delete: Mock<(id: string) => Promise<boolean>>
  findWithPostCount: Mock<() => Promise<(Board & { postCount: number })[]>>
}

// Create hoisted mock functions for the db.select chain and sql template
const { mockGroupBy, _mockWhere, _mockFrom, mockSelect, mockSql } = vi.hoisted(() => {
  const mockGroupBy = vi.fn()
  const _mockWhere = vi.fn(() => ({ groupBy: mockGroupBy }))
  const _mockFrom = vi.fn(() => ({ where: _mockWhere }))
  const mockSelect = vi.fn(() => ({ from: _mockFrom }))
  // sql tagged template function must return an object with .as() method
  const mockSql = vi.fn(() => ({ as: vi.fn(() => 'count_placeholder') }))
  return { mockGroupBy, _mockWhere, _mockFrom, mockSelect, mockSql }
})

// Mock dependencies - do not use importActual to avoid module resolution issues
vi.mock('@quackback/db', () => ({
  withUnitOfWork: vi.fn(),
  BoardRepository: vi.fn(),
  db: {
    query: {
      boards: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      posts: {
        findFirst: vi.fn(),
      },
    },
    select: mockSelect,
    insert: vi.fn(),
  },
  eq: vi.fn(),
  and: vi.fn(),
  sql: mockSql,
  inArray: vi.fn(),
  asc: vi.fn(),
  boards: {},
  posts: { boardId: 'boardId' },
}))

describe('BoardService', () => {
  let boardService: BoardService
  let mockContext: ServiceContext
  let mockBoardRepo: MockBoardRepository
  let mockUnitOfWork: Pick<UnitOfWork, 'db'>

  beforeEach(async () => {
    vi.clearAllMocks()

    // Setup mock context
    mockContext = {
      organizationId: 'org-123',
      userId: 'user-123',
      memberId: 'member_123',
      memberRole: 'admin',
      userName: 'Test User',
      userEmail: 'test@example.com',
    }

    // Setup mock board repository
    mockBoardRepo = {
      findById: vi.fn(),
      findBySlug: vi.fn(),
      findAll: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findWithPostCount: vi.fn(),
    }

    // Setup mock unit of work
    mockUnitOfWork = {
      db: {} as unknown,
    } as UnitOfWork

    boardService = new BoardService()

    // Import the mocked module (use import() not require() for ESM mocking)
    const dbModule = await import('@quackback/db')

    // Mock withUnitOfWork to execute callback immediately
    vi.mocked(dbModule.withUnitOfWork).mockImplementation(
      async <T>(_orgId: string, callback: (uow: UnitOfWork) => Promise<T>) => {
        return callback(mockUnitOfWork as UnitOfWork)
      }
    )

    // Mock BoardRepository constructor (must use function, not arrow, for constructor mocking)
    vi.mocked(dbModule.BoardRepository).mockImplementation(function () {
      return mockBoardRepo
    })
  })

  describe('createBoard', () => {
    it('should create a board with valid input', async () => {
      const input: CreateBoardInput = {
        name: 'Feature Requests',
        description: 'Submit your feature ideas',
      }

      const mockBoard: Board = {
        id: 'board_1',
        organizationId: 'org-123',
        name: 'Feature Requests',
        slug: 'feature-requests',
        description: 'Submit your feature ideas',
        isPublic: true,
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      mockBoardRepo.findBySlug.mockResolvedValue(null)
      mockBoardRepo.create.mockResolvedValue(mockBoard)

      const result = await boardService.createBoard(input, mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.name).toBe('Feature Requests')
        expect(result.value.slug).toBe('feature-requests')
      }
      expect(mockBoardRepo.create).toHaveBeenCalledWith({
        organizationId: 'org-123',
        name: 'Feature Requests',
        slug: 'feature-requests',
        description: 'Submit your feature ideas',
        isPublic: true,
        settings: {},
      })
    })

    it('should generate slug from name when slug not provided', async () => {
      const input: CreateBoardInput = {
        name: 'Bug Reports & Issues',
      }

      const mockBoard: Board = {
        id: 'board_2',
        organizationId: 'org-123',
        name: 'Bug Reports & Issues',
        slug: 'bug-reports-issues',
        description: null,
        isPublic: true,
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      mockBoardRepo.findBySlug.mockResolvedValue(null)
      mockBoardRepo.create.mockResolvedValue(mockBoard)

      const result = await boardService.createBoard(input, mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.slug).toBe('bug-reports-issues')
      }
    })

    it('should handle slug uniqueness by appending counter', async () => {
      const input: CreateBoardInput = {
        name: 'General',
      }

      const existingBoard: Board = {
        id: 'board_existing',
        organizationId: 'org-123',
        name: 'General',
        slug: 'general',
        description: null,
        isPublic: true,
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const mockBoard: Board = {
        ...existingBoard,
        id: 'board_new',
        slug: 'general-1',
      }

      // First call returns existing board, second call returns null
      mockBoardRepo.findBySlug.mockResolvedValueOnce(existingBoard).mockResolvedValueOnce(null)
      mockBoardRepo.create.mockResolvedValue(mockBoard)

      const result = await boardService.createBoard(input, mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.slug).toBe('general-1')
      }
      expect(mockBoardRepo.findBySlug).toHaveBeenCalledTimes(2)
      expect(mockBoardRepo.findBySlug).toHaveBeenNthCalledWith(1, 'general')
      expect(mockBoardRepo.findBySlug).toHaveBeenNthCalledWith(2, 'general-1')
    })

    it('should handle multiple slug collisions', async () => {
      const input: CreateBoardInput = {
        name: 'Ideas',
      }

      const mockBoard: Board = {
        id: 'board_new',
        organizationId: 'org-123',
        name: 'Ideas',
        slug: 'ideas-3',
        description: null,
        isPublic: true,
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      // Simulate collisions for ideas, ideas-1, ideas-2
      // Use partial Board data - findBySlug only needs id and slug to indicate existence
      mockBoardRepo.findBySlug
        .mockResolvedValueOnce(createMockBoard({ id: 'board_existing1', slug: 'ideas' }))
        .mockResolvedValueOnce(createMockBoard({ id: 'board_existing2', slug: 'ideas-1' }))
        .mockResolvedValueOnce(createMockBoard({ id: 'board_existing3', slug: 'ideas-2' }))
        .mockResolvedValueOnce(null)
      mockBoardRepo.create.mockResolvedValue(mockBoard)

      const result = await boardService.createBoard(input, mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.slug).toBe('ideas-3')
      }
      expect(mockBoardRepo.findBySlug).toHaveBeenCalledTimes(4)
    })

    it('should reject empty board name', async () => {
      const input: CreateBoardInput = {
        name: '   ',
      }

      const result = await boardService.createBoard(input, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('required')
      }
    })

    it('should reject board name longer than 100 characters', async () => {
      const input: CreateBoardInput = {
        name: 'a'.repeat(101),
      }

      const result = await boardService.createBoard(input, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('100 characters')
      }
    })

    it('should reject description longer than 500 characters', async () => {
      const input: CreateBoardInput = {
        name: 'Valid Name',
        description: 'a'.repeat(501),
      }

      const result = await boardService.createBoard(input, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('500 characters')
      }
    })

    it('should reject when slug generation produces empty string', async () => {
      const input: CreateBoardInput = {
        name: '!@#$%',
      }

      const result = await boardService.createBoard(input, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('valid slug')
      }
    })

    it('should reject unauthorized user (portal user)', async () => {
      const userContext = { ...mockContext, memberRole: 'user' as const }
      const input: CreateBoardInput = {
        name: 'Feature Requests',
      }

      const result = await boardService.createBoard(input, userContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('UNAUTHORIZED')
        expect(result.error.message).toContain('create boards')
      }
    })

    it('should allow owner to create board', async () => {
      const ownerContext = { ...mockContext, memberRole: 'owner' as const }
      const input: CreateBoardInput = { name: 'Board' }

      const mockBoard: Board = {
        id: 'board_1',
        organizationId: 'org-123',
        name: 'Board',
        slug: 'board',
        description: null,
        isPublic: true,
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      mockBoardRepo.findBySlug.mockResolvedValue(null)
      mockBoardRepo.create.mockResolvedValue(mockBoard)

      const result = await boardService.createBoard(input, ownerContext)

      expect(result.success).toBe(true)
    })

    it('should allow member to create board', async () => {
      const memberContext = { ...mockContext, memberRole: 'member' as const }
      const input: CreateBoardInput = { name: 'Board' }

      const mockBoard: Board = {
        id: 'board_1',
        organizationId: 'org-123',
        name: 'Board',
        slug: 'board',
        description: null,
        isPublic: true,
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      mockBoardRepo.findBySlug.mockResolvedValue(null)
      mockBoardRepo.create.mockResolvedValue(mockBoard)

      const result = await boardService.createBoard(input, memberContext)

      expect(result.success).toBe(true)
    })

    it('should use provided slug over generated slug', async () => {
      const input: CreateBoardInput = {
        name: 'Feature Requests',
        slug: 'features',
      }

      const mockBoard: Board = {
        id: 'board_1',
        organizationId: 'org-123',
        name: 'Feature Requests',
        slug: 'features',
        description: null,
        isPublic: true,
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      mockBoardRepo.findBySlug.mockResolvedValue(null)
      mockBoardRepo.create.mockResolvedValue(mockBoard)

      const result = await boardService.createBoard(input, mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.slug).toBe('features')
      }
    })

    it('should default isPublic to true when not provided', async () => {
      const input: CreateBoardInput = {
        name: 'Board',
      }

      const mockBoard: Board = {
        id: 'board_1',
        organizationId: 'org-123',
        name: 'Board',
        slug: 'board',
        description: null,
        isPublic: true,
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      mockBoardRepo.findBySlug.mockResolvedValue(null)
      mockBoardRepo.create.mockResolvedValue(mockBoard)

      await boardService.createBoard(input, mockContext)

      expect(mockBoardRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          isPublic: true,
        })
      )
    })

    it('should respect isPublic when explicitly set to false', async () => {
      const input: CreateBoardInput = {
        name: 'Private Board',
        isPublic: false,
      }

      const mockBoard: Board = {
        id: 'board_1',
        organizationId: 'org-123',
        name: 'Private Board',
        slug: 'private-board',
        description: null,
        isPublic: false,
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      mockBoardRepo.findBySlug.mockResolvedValue(null)
      mockBoardRepo.create.mockResolvedValue(mockBoard)

      await boardService.createBoard(input, mockContext)

      expect(mockBoardRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          isPublic: false,
        })
      )
    })

    it('should handle custom settings', async () => {
      const settings: BoardSettings = {
        roadmapStatuses: ['planned', 'in_progress'],
      }

      const input: CreateBoardInput = {
        name: 'Board with Settings',
        settings,
      }

      const mockBoard: Board = {
        id: 'board_1',
        organizationId: 'org-123',
        name: 'Board with Settings',
        slug: 'board_with-settings',
        description: null,
        isPublic: true,
        settings,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      mockBoardRepo.findBySlug.mockResolvedValue(null)
      mockBoardRepo.create.mockResolvedValue(mockBoard)

      await boardService.createBoard(input, mockContext)

      expect(mockBoardRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          settings,
        })
      )
    })
  })

  describe('updateBoard', () => {
    const existingBoard: Board = {
      id: 'board_1',
      organizationId: 'org-123',
      name: 'Original Name',
      slug: 'original-name',
      description: 'Original description',
      isPublic: true,
      settings: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    it('should update board name', async () => {
      const input: UpdateBoardInput = {
        name: 'Updated Name',
      }

      const updatedBoard: Board = {
        ...existingBoard,
        name: 'Updated Name',
        slug: 'updated-name',
      }

      mockBoardRepo.findById.mockResolvedValue(existingBoard)
      mockBoardRepo.findBySlug.mockResolvedValue(null)
      mockBoardRepo.update.mockResolvedValue(updatedBoard)

      const result = await boardService.updateBoard('board_1', input, mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.name).toBe('Updated Name')
      }
    })

    it('should return error when board not found', async () => {
      const input: UpdateBoardInput = {
        name: 'Updated Name',
      }

      mockBoardRepo.findById.mockResolvedValue(null)

      const result = await boardService.updateBoard('board_nonexistent', input, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('BOARD_NOT_FOUND')
      }
    })

    it('should reject unauthorized user', async () => {
      const userContext = { ...mockContext, memberRole: 'user' as const }
      const input: UpdateBoardInput = {
        name: 'Updated Name',
      }

      mockBoardRepo.findById.mockResolvedValue(existingBoard)

      const result = await boardService.updateBoard('board_1', input, userContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('UNAUTHORIZED')
        expect(result.error.message).toContain('update boards')
      }
    })

    it('should auto-update slug when name changes', async () => {
      const input: UpdateBoardInput = {
        name: 'New Name',
      }

      const updatedBoard: Board = {
        ...existingBoard,
        name: 'New Name',
        slug: 'new-name',
      }

      mockBoardRepo.findById.mockResolvedValue(existingBoard)
      mockBoardRepo.findBySlug.mockResolvedValue(null)
      mockBoardRepo.update.mockResolvedValue(updatedBoard)

      await boardService.updateBoard('board_1', input, mockContext)

      expect(mockBoardRepo.update).toHaveBeenCalledWith(
        'board_1',
        expect.objectContaining({
          name: 'New Name',
          slug: 'new-name',
        })
      )
    })

    it('should not change slug if new slug already exists for different board', async () => {
      const input: UpdateBoardInput = {
        name: 'Existing Board Name',
      }

      const existingBoardWithSlug: Board = {
        id: 'board_2',
        organizationId: 'org-123',
        name: 'Existing Board Name',
        slug: 'existing-board-name',
        description: null,
        isPublic: true,
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      mockBoardRepo.findById.mockResolvedValue(existingBoard)
      mockBoardRepo.findBySlug.mockResolvedValue(existingBoardWithSlug)
      mockBoardRepo.update.mockResolvedValue({
        ...existingBoard,
        name: 'Existing Board Name',
      })

      await boardService.updateBoard('board_1', input, mockContext)

      expect(mockBoardRepo.update).toHaveBeenCalledWith(
        'board_1',
        expect.not.objectContaining({
          slug: expect.anything(),
        })
      )
    })

    it('should allow explicit slug update', async () => {
      const input: UpdateBoardInput = {
        slug: 'custom-slug',
      }

      const updatedBoard: Board = {
        ...existingBoard,
        slug: 'custom-slug',
      }

      mockBoardRepo.findById.mockResolvedValue(existingBoard)
      mockBoardRepo.findBySlug.mockResolvedValue(null)
      mockBoardRepo.update.mockResolvedValue(updatedBoard)

      const result = await boardService.updateBoard('board_1', input, mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.slug).toBe('custom-slug')
      }
    })

    it('should reject duplicate slug update', async () => {
      const input: UpdateBoardInput = {
        slug: 'existing-slug',
      }

      const anotherBoard: Board = {
        id: 'board_2',
        organizationId: 'org-123',
        name: 'Another Board',
        slug: 'existing-slug',
        description: null,
        isPublic: true,
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      mockBoardRepo.findById.mockResolvedValue(existingBoard)
      mockBoardRepo.findBySlug.mockResolvedValue(anotherBoard)

      const result = await boardService.updateBoard('board_1', input, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('DUPLICATE_SLUG')
      }
    })

    it('should allow updating to same slug', async () => {
      const input: UpdateBoardInput = {
        slug: 'original-name',
      }

      mockBoardRepo.findById.mockResolvedValue(existingBoard)
      mockBoardRepo.findBySlug.mockResolvedValue(existingBoard)
      mockBoardRepo.update.mockResolvedValue(existingBoard)

      const result = await boardService.updateBoard('board_1', input, mockContext)

      expect(result.success).toBe(true)
    })

    it('should reject empty name', async () => {
      const input: UpdateBoardInput = {
        name: '   ',
      }

      mockBoardRepo.findById.mockResolvedValue(existingBoard)

      const result = await boardService.updateBoard('board_1', input, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('cannot be empty')
      }
    })

    it('should reject name longer than 100 characters', async () => {
      const input: UpdateBoardInput = {
        name: 'a'.repeat(101),
      }

      mockBoardRepo.findById.mockResolvedValue(existingBoard)

      const result = await boardService.updateBoard('board_1', input, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('100 characters')
      }
    })

    it('should reject description longer than 500 characters', async () => {
      const input: UpdateBoardInput = {
        description: 'a'.repeat(501),
      }

      mockBoardRepo.findById.mockResolvedValue(existingBoard)

      const result = await boardService.updateBoard('board_1', input, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('500 characters')
      }
    })

    it('should update isPublic flag', async () => {
      const input: UpdateBoardInput = {
        isPublic: false,
      }

      const updatedBoard: Board = {
        ...existingBoard,
        isPublic: false,
      }

      mockBoardRepo.findById.mockResolvedValue(existingBoard)
      mockBoardRepo.update.mockResolvedValue(updatedBoard)

      await boardService.updateBoard('board_1', input, mockContext)

      expect(mockBoardRepo.update).toHaveBeenCalledWith(
        'board_1',
        expect.objectContaining({
          isPublic: false,
        })
      )
    })

    it('should reject invalid slug that becomes empty', async () => {
      const input: UpdateBoardInput = {
        slug: '!@#$',
      }

      mockBoardRepo.findById.mockResolvedValue(existingBoard)

      const result = await boardService.updateBoard('board_1', input, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('valid slug')
      }
    })

    it('should allow null description', async () => {
      const input: UpdateBoardInput = {
        description: null,
      }

      const updatedBoard: Board = {
        ...existingBoard,
        description: null,
      }

      mockBoardRepo.findById.mockResolvedValue(existingBoard)
      mockBoardRepo.update.mockResolvedValue(updatedBoard)

      const result = await boardService.updateBoard('board_1', input, mockContext)

      expect(result.success).toBe(true)
    })
  })

  describe('deleteBoard', () => {
    const existingBoard: Board = {
      id: 'board_1',
      organizationId: 'org-123',
      name: 'Board to Delete',
      slug: 'board_to-delete',
      description: null,
      isPublic: true,
      settings: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    it('should delete board successfully', async () => {
      mockBoardRepo.findById.mockResolvedValue(existingBoard)
      mockBoardRepo.delete.mockResolvedValue(true)

      const result = await boardService.deleteBoard('board_1', mockContext)

      expect(result.success).toBe(true)
      expect(mockBoardRepo.delete).toHaveBeenCalledWith('board_1')
    })

    it('should return error when board not found', async () => {
      mockBoardRepo.findById.mockResolvedValue(null)

      const result = await boardService.deleteBoard('board_nonexistent', mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('BOARD_NOT_FOUND')
      }
    })

    it('should reject unauthorized user (member)', async () => {
      const memberContext = { ...mockContext, memberRole: 'member' as const }

      mockBoardRepo.findById.mockResolvedValue(existingBoard)

      const result = await boardService.deleteBoard('board_1', memberContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('UNAUTHORIZED')
        expect(result.error.message).toContain('delete boards')
      }
    })

    it('should allow owner to delete board', async () => {
      const ownerContext = { ...mockContext, memberRole: 'owner' as const }

      mockBoardRepo.findById.mockResolvedValue(existingBoard)
      mockBoardRepo.delete.mockResolvedValue(true)

      const result = await boardService.deleteBoard('board_1', ownerContext)

      expect(result.success).toBe(true)
    })

    it('should allow admin to delete board', async () => {
      const adminContext = { ...mockContext, memberRole: 'admin' as const }

      mockBoardRepo.findById.mockResolvedValue(existingBoard)
      mockBoardRepo.delete.mockResolvedValue(true)

      const result = await boardService.deleteBoard('board_1', adminContext)

      expect(result.success).toBe(true)
    })
  })

  describe('getBoardById', () => {
    it('should return board when found', async () => {
      const mockBoard: Board = {
        id: 'board_1',
        organizationId: 'org-123',
        name: 'Test Board',
        slug: 'test-board',
        description: null,
        isPublic: true,
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      mockBoardRepo.findById.mockResolvedValue(mockBoard)

      const result = await boardService.getBoardById('board_1', mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.id).toBe('board_1')
        expect(result.value.name).toBe('Test Board')
      }
    })

    it('should return error when board not found', async () => {
      mockBoardRepo.findById.mockResolvedValue(null)

      const result = await boardService.getBoardById('board_nonexistent', mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('BOARD_NOT_FOUND')
      }
    })
  })

  describe('getBoardBySlug', () => {
    it('should return board when found by slug', async () => {
      const mockBoard: Board = {
        id: 'board_1',
        organizationId: 'org-123',
        name: 'Test Board',
        slug: 'test-board',
        description: null,
        isPublic: true,
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      mockBoardRepo.findBySlug.mockResolvedValue(mockBoard)

      const result = await boardService.getBoardBySlug('test-board', mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.slug).toBe('test-board')
      }
    })

    it('should return error when board not found by slug', async () => {
      mockBoardRepo.findBySlug.mockResolvedValue(null)

      const result = await boardService.getBoardBySlug('board_nonexistent', mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('BOARD_NOT_FOUND')
      }
    })
  })

  describe('listBoards', () => {
    it('should return all boards for organization', async () => {
      const mockBoards: Board[] = [
        {
          id: 'board_1',
          organizationId: 'org-123',
          name: 'Board 1',
          slug: 'board_1',
          description: null,
          isPublic: true,
          settings: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'board_2',
          organizationId: 'org-123',
          name: 'Board 2',
          slug: 'board_2',
          description: null,
          isPublic: false,
          settings: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]

      mockBoardRepo.findAll.mockResolvedValue(mockBoards)

      const result = await boardService.listBoards(mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toHaveLength(2)
        expect(result.value[0].name).toBe('Board 1')
        expect(result.value[1].name).toBe('Board 2')
      }
    })

    it('should return empty array when no boards exist', async () => {
      mockBoardRepo.findAll.mockResolvedValue([])

      const result = await boardService.listBoards(mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toHaveLength(0)
      }
    })
  })

  describe('listBoardsWithDetails', () => {
    it('should return boards with post counts', async () => {
      const mockBoardsWithDetails: (Board & { postCount: number })[] = [
        {
          id: 'board_1' as BoardId,
          organizationId: 'org-123',
          name: 'Board 1',
          slug: 'board_1',
          description: null,
          isPublic: true,
          settings: {},
          createdAt: new Date(),
          updatedAt: new Date(),
          postCount: 5,
        },
        {
          id: 'board_2' as BoardId,
          organizationId: 'org-123',
          name: 'Board 2',
          slug: 'board_2',
          description: null,
          isPublic: true,
          settings: {},
          createdAt: new Date(),
          updatedAt: new Date(),
          postCount: 0,
        },
      ]

      mockBoardRepo.findWithPostCount.mockResolvedValue(mockBoardsWithDetails)

      const result = await boardService.listBoardsWithDetails(mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toHaveLength(2)
        expect(result.value[0].postCount).toBe(5)
        expect(result.value[1].postCount).toBe(0)
      }
    })
  })

  describe('updateBoardSettings', () => {
    const existingBoard: Board = {
      id: 'board_1',
      organizationId: 'org-123',
      name: 'Test Board',
      slug: 'test-board',
      description: null,
      isPublic: true,
      settings: {
        roadmapStatuses: ['planned', 'in_progress', 'complete'],
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    it('should merge new settings with existing settings', async () => {
      const newSettings: BoardSettings = {
        roadmapStatuses: ['planned', 'in_progress'],
      }

      const updatedBoard: Board = {
        ...existingBoard,
        settings: {
          roadmapStatuses: ['planned', 'in_progress'],
        },
      }

      mockBoardRepo.findById.mockResolvedValue(existingBoard)
      mockBoardRepo.update.mockResolvedValue(updatedBoard)

      const result = await boardService.updateBoardSettings('board_1', newSettings, mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.settings).toEqual({
          roadmapStatuses: ['planned', 'in_progress'],
        })
      }
    })

    it('should return error when board not found', async () => {
      mockBoardRepo.findById.mockResolvedValue(null)

      const result = await boardService.updateBoardSettings('board_nonexistent', {}, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('BOARD_NOT_FOUND')
      }
    })

    it('should reject unauthorized user', async () => {
      const userContext = { ...mockContext, memberRole: 'user' as const }

      mockBoardRepo.findById.mockResolvedValue(existingBoard)

      const result = await boardService.updateBoardSettings('board_1', {}, userContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('UNAUTHORIZED')
      }
    })

    it('should handle empty existing settings', async () => {
      const boardWithoutSettings: Board = {
        ...existingBoard,
        settings: {},
      }

      const newSettings: BoardSettings = {
        roadmapStatuses: ['planned'],
      }

      const updatedBoard: Board = {
        ...boardWithoutSettings,
        settings: newSettings,
      }

      mockBoardRepo.findById.mockResolvedValue(boardWithoutSettings)
      mockBoardRepo.update.mockResolvedValue(updatedBoard)

      const result = await boardService.updateBoardSettings('board_1', newSettings, mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.settings).toEqual(newSettings)
      }
    })
  })

  describe('getPublicBoardById', () => {
    it('should return public board without authentication', async () => {
      const mockBoard: Board = {
        id: 'board_1',
        organizationId: 'org-123',
        name: 'Public Board',
        slug: 'public-board',
        description: null,
        isPublic: true,
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const { db } = await import('@quackback/db')
      vi.mocked(db.query.boards.findFirst).mockResolvedValue(mockBoard)

      const result = await boardService.getPublicBoardById('board_1')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.id).toBe('board_1')
      }
    })

    it('should return error when board not found', async () => {
      const { db } = await import('@quackback/db')
      vi.mocked(db.query.boards.findFirst).mockResolvedValue(undefined)

      const result = await boardService.getPublicBoardById('board_nonexistent')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('BOARD_NOT_FOUND')
      }
    })

    it('should handle database errors', async () => {
      const { db } = await import('@quackback/db')
      vi.mocked(db.query.boards.findFirst).mockRejectedValue(new Error('Database error'))

      const result = await boardService.getPublicBoardById('board_1')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('Database error')
      }
    })
  })

  describe('listPublicBoardsWithStats', () => {
    it('should return only public boards with post counts', async () => {
      const mockBoards: Board[] = [
        {
          id: 'board_1',
          organizationId: 'org-123',
          name: 'Public Board 1',
          slug: 'public-board-1',
          description: null,
          isPublic: true,
          settings: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'board_2',
          organizationId: 'org-123',
          name: 'Public Board 2',
          slug: 'public-board-2',
          description: null,
          isPublic: true,
          settings: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]

      const { db } = await import('@quackback/db')
      vi.mocked(db.query.boards.findMany).mockResolvedValue(mockBoards)
      // Use the hoisted mock for the groupBy result
      mockGroupBy.mockResolvedValue([
        { boardId: 'board_1', count: 10 },
        { boardId: 'board_2', count: 5 },
      ])

      const result = await boardService.listPublicBoardsWithStats('org-123')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toHaveLength(2)
        expect(result.value[0].postCount).toBe(10)
        expect(result.value[1].postCount).toBe(5)
      }
    })

    it('should return empty array when no public boards exist', async () => {
      const { db } = await import('@quackback/db')
      vi.mocked(db.query.boards.findMany).mockResolvedValue([])

      const result = await boardService.listPublicBoardsWithStats('org-123')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toHaveLength(0)
      }
    })

    it('should handle boards with no posts', async () => {
      const mockBoards: Board[] = [
        {
          id: 'board_1',
          organizationId: 'org-123',
          name: 'Empty Board',
          slug: 'empty-board',
          description: null,
          isPublic: true,
          settings: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]

      const { db } = await import('@quackback/db')
      vi.mocked(db.query.boards.findMany).mockResolvedValue(mockBoards)
      // Use the hoisted mock for the groupBy result (empty = no posts)
      mockGroupBy.mockResolvedValue([])

      const result = await boardService.listPublicBoardsWithStats('org-123')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toHaveLength(1)
        expect(result.value[0].postCount).toBe(0)
      }
    })
  })

  describe('getPublicBoardBySlug', () => {
    it('should return public board by slug', async () => {
      const mockBoard: Board = {
        id: 'board_1',
        organizationId: 'org-123',
        name: 'Public Board',
        slug: 'public-board',
        description: null,
        isPublic: true,
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const { db } = await import('@quackback/db')
      vi.mocked(db.query.boards.findFirst).mockResolvedValue(mockBoard)

      const result = await boardService.getPublicBoardBySlug('org-123', 'public-board')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value?.slug).toBe('public-board')
      }
    })

    it('should return null when private board found by slug', async () => {
      const { db } = await import('@quackback/db')
      vi.mocked(db.query.boards.findFirst).mockResolvedValue(undefined)

      const result = await boardService.getPublicBoardBySlug('org-123', 'private-board')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toBeNull()
      }
    })

    it('should return null when board not found', async () => {
      const { db } = await import('@quackback/db')
      vi.mocked(db.query.boards.findFirst).mockResolvedValue(undefined)

      const result = await boardService.getPublicBoardBySlug('org-123', 'board_nonexistent')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toBeNull()
      }
    })
  })
})
