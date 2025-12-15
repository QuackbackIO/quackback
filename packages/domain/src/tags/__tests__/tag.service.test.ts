import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TagService } from '../tag.service'
import type { CreateTagInput, UpdateTagInput } from '../tag.types'
import type { Tag } from '@quackback/db/types'
import {
  createMockServiceContext,
  createMockTag,
  createMockBoard,
} from '../../__tests__/test-utils'

// Use vi.hoisted to create mock instances that are available at mock factory time
const { mockTagRepoInstance, mockBoardRepoInstance } = vi.hoisted(() => ({
  mockTagRepoInstance: {
    findById: vi.fn(),
    findAll: vi.fn(),
    findByBoardId: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  mockBoardRepoInstance: {
    findById: vi.fn(),
  },
}))

// Mock @quackback/db module
vi.mock('@quackback/db', () => {
  // Create mock class constructors
  class MockTagRepository {
    findById = mockTagRepoInstance.findById
    findAll = mockTagRepoInstance.findAll
    findByBoardId = mockTagRepoInstance.findByBoardId
    create = mockTagRepoInstance.create
    update = mockTagRepoInstance.update
    delete = mockTagRepoInstance.delete
  }

  class MockBoardRepository {
    findById = mockBoardRepoInstance.findById
  }

  return {
    withUnitOfWork: vi.fn(
      async (_orgId: string, callback: (uow: { db: unknown }) => Promise<unknown>) => {
        return callback({ db: {} })
      }
    ),
    TagRepository: MockTagRepository,
    BoardRepository: MockBoardRepository,
    // For listPublicTags method which uses dynamic import
    db: {
      query: {
        tags: {
          findMany: vi.fn(),
        },
      },
    },
    tags: { organizationId: 'organizationId' },
    asc: vi.fn((col: unknown) => col),
    eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
  }
})

describe('TagService', () => {
  let tagService: TagService

  beforeEach(() => {
    vi.clearAllMocks()

    // Reset mock implementations
    mockTagRepoInstance.findById.mockReset()
    mockTagRepoInstance.findAll.mockReset().mockResolvedValue([])
    mockTagRepoInstance.findByBoardId.mockReset().mockResolvedValue([])
    mockTagRepoInstance.create.mockReset()
    mockTagRepoInstance.update.mockReset()
    mockTagRepoInstance.delete.mockReset()
    mockBoardRepoInstance.findById.mockReset()

    tagService = new TagService()
  })

  describe('createTag', () => {
    it('should create a tag successfully with valid input', async () => {
      const ctx = createMockServiceContext()
      const input: CreateTagInput = { name: 'Bug', color: '#ff0000' }
      const createdTag = createMockTag({ id: 'tag_new', name: 'Bug', color: '#ff0000' })

      mockTagRepoInstance.findAll.mockResolvedValue([])
      mockTagRepoInstance.create.mockResolvedValue(createdTag)

      const result = await tagService.createTag(input, ctx)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.name).toBe('Bug')
        expect(result.value.color).toBe('#ff0000')
      }
      expect(mockTagRepoInstance.create).toHaveBeenCalledWith({
        organizationId: ctx.organizationId,
        name: 'Bug',
        color: '#ff0000',
      })
    })

    it('should use default color if none provided', async () => {
      const ctx = createMockServiceContext()
      const input: CreateTagInput = { name: 'Feature' }
      const createdTag = createMockTag({ name: 'Feature', color: '#6b7280' })

      mockTagRepoInstance.findAll.mockResolvedValue([])
      mockTagRepoInstance.create.mockResolvedValue(createdTag)

      const result = await tagService.createTag(input, ctx)

      expect(result.success).toBe(true)
      expect(mockTagRepoInstance.create).toHaveBeenCalledWith(
        expect.objectContaining({ color: '#6b7280' })
      )
    })

    it('should trim whitespace from tag name', async () => {
      const ctx = createMockServiceContext()
      const input: CreateTagInput = { name: '  Bug  ' }
      const createdTag = createMockTag({ name: 'Bug' })

      mockTagRepoInstance.findAll.mockResolvedValue([])
      mockTagRepoInstance.create.mockResolvedValue(createdTag)

      const result = await tagService.createTag(input, ctx)

      expect(result.success).toBe(true)
      expect(mockTagRepoInstance.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Bug' })
      )
    })

    it('should return error when tag name is empty', async () => {
      const ctx = createMockServiceContext()
      const input: CreateTagInput = { name: '' }

      const result = await tagService.createTag(input, ctx)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toBeDefined()
      }
    })

    it('should return error when tag name is only whitespace', async () => {
      const ctx = createMockServiceContext()
      const input: CreateTagInput = { name: '   ' }

      const result = await tagService.createTag(input, ctx)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
      }
    })

    it('should return error when tag name exceeds 50 characters', async () => {
      const ctx = createMockServiceContext()
      const input: CreateTagInput = { name: 'a'.repeat(51) }

      const result = await tagService.createTag(input, ctx)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('50 characters')
      }
    })

    it('should return error when duplicate name exists (case-insensitive)', async () => {
      const ctx = createMockServiceContext()
      const input: CreateTagInput = { name: 'bug' }
      const existingTag = createMockTag({ name: 'BUG' })

      mockTagRepoInstance.findAll.mockResolvedValue([existingTag])

      const result = await tagService.createTag(input, ctx)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('DUPLICATE_NAME')
      }
    })

    it('should return error when color format is invalid', async () => {
      const ctx = createMockServiceContext()
      const input: CreateTagInput = { name: 'Bug', color: 'red' }

      mockTagRepoInstance.findAll.mockResolvedValue([])

      const result = await tagService.createTag(input, ctx)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('hex color')
      }
    })

    it('should return error when color is invalid hex (too short)', async () => {
      const ctx = createMockServiceContext()
      const input: CreateTagInput = { name: 'Bug', color: '#fff' }

      mockTagRepoInstance.findAll.mockResolvedValue([])

      const result = await tagService.createTag(input, ctx)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
      }
    })

    it('should accept valid uppercase hex color', async () => {
      const ctx = createMockServiceContext()
      const input: CreateTagInput = { name: 'Bug', color: '#FF0000' }
      const createdTag = createMockTag({ name: 'Bug', color: '#FF0000' })

      mockTagRepoInstance.findAll.mockResolvedValue([])
      mockTagRepoInstance.create.mockResolvedValue(createdTag)

      const result = await tagService.createTag(input, ctx)

      expect(result.success).toBe(true)
    })

    it('should return error when user is portal user (role=user)', async () => {
      const ctx = createMockServiceContext({ memberRole: 'user' })
      const input: CreateTagInput = { name: 'Bug' }

      const result = await tagService.createTag(input, ctx)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('UNAUTHORIZED')
      }
    })

    it('should allow owner to create tags', async () => {
      const ctx = createMockServiceContext({ memberRole: 'owner' })
      const input: CreateTagInput = { name: 'Bug' }
      const createdTag = createMockTag({ name: 'Bug' })

      mockTagRepoInstance.findAll.mockResolvedValue([])
      mockTagRepoInstance.create.mockResolvedValue(createdTag)

      const result = await tagService.createTag(input, ctx)

      expect(result.success).toBe(true)
    })

    it('should allow member to create tags', async () => {
      const ctx = createMockServiceContext({ memberRole: 'member' })
      const input: CreateTagInput = { name: 'Bug' }
      const createdTag = createMockTag({ name: 'Bug' })

      mockTagRepoInstance.findAll.mockResolvedValue([])
      mockTagRepoInstance.create.mockResolvedValue(createdTag)

      const result = await tagService.createTag(input, ctx)

      expect(result.success).toBe(true)
    })
  })

  describe('updateTag', () => {
    it('should update tag name successfully', async () => {
      const ctx = createMockServiceContext()
      const existingTag = createMockTag({ id: 'tag_123', name: 'Bug' })
      const updatedTag = createMockTag({ id: 'tag_123', name: 'Bug Fix' })
      const input: UpdateTagInput = { name: 'Bug Fix' }

      mockTagRepoInstance.findById.mockResolvedValue(existingTag)
      mockTagRepoInstance.findAll.mockResolvedValue([existingTag])
      mockTagRepoInstance.update.mockResolvedValue(updatedTag)

      const result = await tagService.updateTag('tag_123', input, ctx)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.name).toBe('Bug Fix')
      }
    })

    it('should update tag color successfully', async () => {
      const ctx = createMockServiceContext()
      const existingTag = createMockTag({ id: 'tag_123', color: '#ff0000' })
      const updatedTag = createMockTag({ id: 'tag_123', color: '#00ff00' })
      const input: UpdateTagInput = { color: '#00ff00' }

      mockTagRepoInstance.findById.mockResolvedValue(existingTag)
      mockTagRepoInstance.update.mockResolvedValue(updatedTag)

      const result = await tagService.updateTag('tag_123', input, ctx)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.color).toBe('#00ff00')
      }
    })

    it('should update both name and color', async () => {
      const ctx = createMockServiceContext()
      const existingTag = createMockTag({ id: 'tag_123' })
      const updatedTag = createMockTag({ id: 'tag_123', name: 'New Name', color: '#123456' })
      const input: UpdateTagInput = { name: 'New Name', color: '#123456' }

      mockTagRepoInstance.findById.mockResolvedValue(existingTag)
      mockTagRepoInstance.findAll.mockResolvedValue([existingTag])
      mockTagRepoInstance.update.mockResolvedValue(updatedTag)

      const result = await tagService.updateTag('tag_123', input, ctx)

      expect(result.success).toBe(true)
    })

    it('should return error when tag not found', async () => {
      const ctx = createMockServiceContext()
      const input: UpdateTagInput = { name: 'New Name' }

      mockTagRepoInstance.findById.mockResolvedValue(null)

      const result = await tagService.updateTag('tag_nonexistent', input, ctx)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('TAG_NOT_FOUND')
      }
    })

    it('should return error when update name is empty', async () => {
      const ctx = createMockServiceContext()
      const existingTag = createMockTag({ id: 'tag_123' })
      const input: UpdateTagInput = { name: '' }

      mockTagRepoInstance.findById.mockResolvedValue(existingTag)

      const result = await tagService.updateTag('tag_123', input, ctx)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
      }
    })

    it('should return error when update name exceeds 50 characters', async () => {
      const ctx = createMockServiceContext()
      const existingTag = createMockTag({ id: 'tag_123' })
      const input: UpdateTagInput = { name: 'a'.repeat(51) }

      mockTagRepoInstance.findById.mockResolvedValue(existingTag)

      const result = await tagService.updateTag('tag_123', input, ctx)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
      }
    })

    it('should return error when duplicate name exists on rename (case-insensitive)', async () => {
      const ctx = createMockServiceContext()
      const existingTag = createMockTag({ id: 'tag_123', name: 'Bug' })
      const otherTag = createMockTag({ id: 'tag_456', name: 'Feature' })
      const input: UpdateTagInput = { name: 'FEATURE' }

      mockTagRepoInstance.findById.mockResolvedValue(existingTag)
      mockTagRepoInstance.findAll.mockResolvedValue([existingTag, otherTag])

      const result = await tagService.updateTag('tag_123', input, ctx)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('DUPLICATE_NAME')
      }
    })

    it('should allow renaming to same name with different case', async () => {
      const ctx = createMockServiceContext()
      const existingTag = createMockTag({ id: 'tag_123', name: 'bug' })
      const updatedTag = createMockTag({ id: 'tag_123', name: 'Bug' })
      const input: UpdateTagInput = { name: 'Bug' }

      mockTagRepoInstance.findById.mockResolvedValue(existingTag)
      mockTagRepoInstance.findAll.mockResolvedValue([existingTag])
      mockTagRepoInstance.update.mockResolvedValue(updatedTag)

      const result = await tagService.updateTag('tag_123', input, ctx)

      expect(result.success).toBe(true)
    })

    it('should return error when color format is invalid', async () => {
      const ctx = createMockServiceContext()
      const existingTag = createMockTag({ id: 'tag_123' })
      const input: UpdateTagInput = { color: 'invalid' }

      mockTagRepoInstance.findById.mockResolvedValue(existingTag)

      const result = await tagService.updateTag('tag_123', input, ctx)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
      }
    })

    it('should return error when user is unauthorized', async () => {
      const ctx = createMockServiceContext({ memberRole: 'user' })
      const input: UpdateTagInput = { name: 'New Name' }

      const result = await tagService.updateTag('tag_123', input, ctx)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('UNAUTHORIZED')
      }
    })
  })

  describe('deleteTag', () => {
    it('should delete tag successfully', async () => {
      const ctx = createMockServiceContext()
      const existingTag = createMockTag({ id: 'tag_123' })

      mockTagRepoInstance.findById.mockResolvedValue(existingTag)
      mockTagRepoInstance.delete.mockResolvedValue(true)

      const result = await tagService.deleteTag('tag_123', ctx)

      expect(result.success).toBe(true)
      expect(mockTagRepoInstance.delete).toHaveBeenCalledWith('tag_123')
    })

    it('should return error when tag not found', async () => {
      const ctx = createMockServiceContext()

      mockTagRepoInstance.findById.mockResolvedValue(null)

      const result = await tagService.deleteTag('tag_nonexistent', ctx)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('TAG_NOT_FOUND')
      }
    })

    it('should return error when user is unauthorized', async () => {
      const ctx = createMockServiceContext({ memberRole: 'user' })

      const result = await tagService.deleteTag('tag_123', ctx)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('UNAUTHORIZED')
      }
    })

    it('should return error when delete operation fails', async () => {
      const ctx = createMockServiceContext()
      const existingTag = createMockTag({ id: 'tag_123' })

      mockTagRepoInstance.findById.mockResolvedValue(existingTag)
      mockTagRepoInstance.delete.mockResolvedValue(false)

      const result = await tagService.deleteTag('tag_123', ctx)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('TAG_NOT_FOUND')
      }
    })
  })

  describe('getTagById', () => {
    it('should return tag when found', async () => {
      const ctx = createMockServiceContext()
      const tag = createMockTag({ id: 'tag_123', name: 'Bug' })

      mockTagRepoInstance.findById.mockResolvedValue(tag)

      const result = await tagService.getTagById('tag_123', ctx)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.id).toBe('tag_123')
        expect(result.value.name).toBe('Bug')
      }
    })

    it('should return error when tag not found', async () => {
      const ctx = createMockServiceContext()

      mockTagRepoInstance.findById.mockResolvedValue(null)

      const result = await tagService.getTagById('tag_nonexistent', ctx)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('TAG_NOT_FOUND')
      }
    })
  })

  describe('listTags', () => {
    it('should return all tags for organization', async () => {
      const ctx = createMockServiceContext()
      const tags = [
        createMockTag({ id: 'tag_1', name: 'Bug' }),
        createMockTag({ id: 'tag_2', name: 'Feature' }),
      ]

      mockTagRepoInstance.findAll.mockResolvedValue(tags)

      const result = await tagService.listTags(ctx)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toHaveLength(2)
      }
    })

    it('should return empty array when no tags exist', async () => {
      const ctx = createMockServiceContext()

      mockTagRepoInstance.findAll.mockResolvedValue([])

      const result = await tagService.listTags(ctx)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toHaveLength(0)
      }
    })
  })

  describe('getTagsByBoard', () => {
    it('should return tags used in board', async () => {
      const ctx = createMockServiceContext()
      const board = createMockBoard({ id: 'board_123' })
      const tags = [
        createMockTag({ id: 'tag_1', name: 'Bug' }),
        createMockTag({ id: 'tag_2', name: 'Feature' }),
      ]

      mockBoardRepoInstance.findById.mockResolvedValue(board)
      mockTagRepoInstance.findByBoardId.mockResolvedValue(tags)

      const result = await tagService.getTagsByBoard('board_123', ctx)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toHaveLength(2)
      }
      expect(mockTagRepoInstance.findByBoardId).toHaveBeenCalledWith('board_123')
    })

    it('should return error when board not found', async () => {
      const ctx = createMockServiceContext()

      mockBoardRepoInstance.findById.mockResolvedValue(null)

      const result = await tagService.getTagsByBoard('board_nonexistent', ctx)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
      }
    })

    it('should return empty array when board has no tags', async () => {
      const ctx = createMockServiceContext()
      const board = createMockBoard({ id: 'board_123' })

      mockBoardRepoInstance.findById.mockResolvedValue(board)
      mockTagRepoInstance.findByBoardId.mockResolvedValue([])

      const result = await tagService.getTagsByBoard('board_123', ctx)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toHaveLength(0)
      }
    })
  })

  describe('listPublicTags', () => {
    it('should return tags without authentication', async () => {
      const mockTags: Tag[] = [
        createMockTag({ id: 'tag_1', name: 'Bug', color: '#ff0000' }) as Tag,
        createMockTag({ id: 'tag_2', name: 'Feature', color: '#00ff00' }) as Tag,
      ]

      const { db } = await import('@quackback/db')
      vi.mocked(db.query.tags.findMany).mockResolvedValue(mockTags)

      const result = await tagService.listPublicTags('org-123')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toHaveLength(2)
        expect(result.value[0].name).toBe('Bug')
        expect(result.value[1].name).toBe('Feature')
      }
    })

    it('should return empty array when no tags exist', async () => {
      const { db } = await import('@quackback/db')
      vi.mocked(db.query.tags.findMany).mockResolvedValue([])

      const result = await tagService.listPublicTags('org-123')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toHaveLength(0)
      }
    })

    it('should return error on database failure', async () => {
      const { db } = await import('@quackback/db')
      vi.mocked(db.query.tags.findMany).mockRejectedValue(new Error('Database error'))

      const result = await tagService.listPublicTags('org-123')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('Failed to fetch tags')
      }
    })
  })
})
