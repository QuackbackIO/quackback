import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StatusService } from '../status.service'
import type { CreateStatusInput, UpdateStatusInput, Status } from '../status.types'
import type { ServiceContext } from '../../shared/service-context'
import type { StatusId } from '@quackback/ids'

// Use vi.hoisted to create mock instances that are available at mock factory time
const { mockStatusRepoInstance, mockDbInstance } = vi.hoisted(() => ({
  mockStatusRepoInstance: {
    findById: vi.fn(),
    findBySlug: vi.fn(),
    findAll: vi.fn(),
    findDefault: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    reorder: vi.fn(),
    setDefault: vi.fn(),
  },
  mockDbInstance: {
    query: {
      postStatuses: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
    },
    insert: vi.fn(),
    select: vi.fn(),
  },
}))

// Mock @quackback/db module
vi.mock('@quackback/db', () => ({
  withUnitOfWork: vi.fn(async (callback: (uow: { db: unknown }) => Promise<unknown>) => {
    return callback({ db: mockDbInstance })
  }),
  StatusRepository: vi.fn(),
  db: mockDbInstance,
  eq: vi.fn(),
  sql: vi.fn(),
  and: vi.fn(),
  asc: vi.fn(),
  posts: {},
  postStatuses: {},
  DEFAULT_STATUSES: [
    {
      name: 'Open',
      slug: 'open',
      color: '#3b82f6',
      category: 'active',
      position: 0,
      showOnRoadmap: false,
      isDefault: true,
    },
  ],
}))

describe('StatusService', () => {
  let statusService: StatusService
  let mockContext: ServiceContext

  beforeEach(async () => {
    vi.clearAllMocks()

    // Reset mock implementations
    mockStatusRepoInstance.findById.mockReset()
    mockStatusRepoInstance.findBySlug.mockReset()
    mockStatusRepoInstance.findAll.mockReset()
    mockStatusRepoInstance.findDefault.mockReset()
    mockStatusRepoInstance.create.mockReset()
    mockStatusRepoInstance.update.mockReset()
    mockStatusRepoInstance.delete.mockReset()
    mockStatusRepoInstance.reorder.mockReset()
    mockStatusRepoInstance.setDefault.mockReset()
    mockDbInstance.query.postStatuses.findFirst.mockReset()
    mockDbInstance.query.postStatuses.findMany.mockReset()
    mockDbInstance.insert.mockReset()
    mockDbInstance.select.mockReset()

    // Setup mock context
    mockContext = {
      userId: 'user-123',
      memberId: 'member_123',
      memberRole: 'admin',
      userName: 'Test User',
      userEmail: 'test@example.com',
    }

    statusService = new StatusService()

    // Import the mocked module (use import() not require() for ESM mocking)
    const dbModule = await import('@quackback/db')

    // Mock StatusRepository constructor (must use function, not arrow, for constructor mocking)
    vi.mocked(dbModule.StatusRepository).mockImplementation(function () {
      return mockStatusRepoInstance
    })

    // Setup default db.select mock for deleteStatus tests
    mockDbInstance.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ count: 0 }]),
      }),
    })
  })

  describe('createStatus', () => {
    it('should create a status with valid input', async () => {
      const input: CreateStatusInput = {
        name: 'In Progress',
        slug: 'in_progress',
        color: '#f59e0b',
        category: 'active',
        position: 1,
      }

      const mockStatus: Status = {
        id: 'status_1',
        name: 'In Progress',
        slug: 'in_progress',
        color: '#f59e0b',
        category: 'active',
        position: 1,
        showOnRoadmap: false,
        isDefault: false,
        createdAt: new Date(),
      }

      mockStatusRepoInstance.findBySlug.mockResolvedValue(null)
      mockStatusRepoInstance.create.mockResolvedValue(mockStatus)

      const result = await statusService.createStatus(input, mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.name).toBe('In Progress')
        expect(result.value.slug).toBe('in_progress')
        expect(result.value.color).toBe('#f59e0b')
      }
    })

    it('should reject empty status name', async () => {
      const input: CreateStatusInput = {
        name: '   ',
        slug: 'test',
        color: '#3b82f6',
        category: 'active',
      }

      const result = await statusService.createStatus(input, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('required')
      }
    })

    it('should reject name longer than 50 characters', async () => {
      const input: CreateStatusInput = {
        name: 'a'.repeat(51),
        slug: 'test',
        color: '#3b82f6',
        category: 'active',
      }

      const result = await statusService.createStatus(input, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('50 characters')
      }
    })

    it('should reject empty slug', async () => {
      const input: CreateStatusInput = {
        name: 'Valid Name',
        slug: '   ',
        color: '#3b82f6',
        category: 'active',
      }

      const result = await statusService.createStatus(input, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('Slug is required')
      }
    })

    it('should reject slug longer than 50 characters', async () => {
      const input: CreateStatusInput = {
        name: 'Valid Name',
        slug: 'a'.repeat(51),
        color: '#3b82f6',
        category: 'active',
      }

      const result = await statusService.createStatus(input, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('50 characters')
      }
    })

    it('should reject slug with uppercase letters', async () => {
      const input: CreateStatusInput = {
        name: 'Valid Name',
        slug: 'Invalid_Slug',
        color: '#3b82f6',
        category: 'active',
      }

      const result = await statusService.createStatus(input, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('lowercase with underscores')
      }
    })

    it('should reject slug with hyphens', async () => {
      const input: CreateStatusInput = {
        name: 'Valid Name',
        slug: 'invalid-slug',
        color: '#3b82f6',
        category: 'active',
      }

      const result = await statusService.createStatus(input, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('lowercase with underscores')
      }
    })

    it('should reject slug with spaces', async () => {
      const input: CreateStatusInput = {
        name: 'Valid Name',
        slug: 'invalid slug',
        color: '#3b82f6',
        category: 'active',
      }

      const result = await statusService.createStatus(input, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('lowercase with underscores')
      }
    })

    it('should accept valid slug with underscores and numbers', async () => {
      const input: CreateStatusInput = {
        name: 'Test',
        slug: 'valid_slug_123',
        color: '#3b82f6',
        category: 'active',
      }

      const mockStatus: Status = {
        id: 'status_1',
        name: 'Test',
        slug: 'valid_slug_123',
        color: '#3b82f6',
        category: 'active',
        position: 0,
        showOnRoadmap: false,
        isDefault: false,
        createdAt: new Date(),
      }

      mockStatusRepoInstance.findBySlug.mockResolvedValue(null)
      mockStatusRepoInstance.create.mockResolvedValue(mockStatus)

      const result = await statusService.createStatus(input, mockContext)

      expect(result.success).toBe(true)
    })

    it('should reject empty color', async () => {
      const input: CreateStatusInput = {
        name: 'Valid Name',
        slug: 'valid_slug',
        color: '   ',
        category: 'active',
      }

      const result = await statusService.createStatus(input, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('Color is required')
      }
    })

    it('should reject invalid hex color format', async () => {
      const input: CreateStatusInput = {
        name: 'Valid Name',
        slug: 'valid_slug',
        color: 'blue',
        category: 'active',
      }

      const result = await statusService.createStatus(input, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('hex format')
      }
    })

    it('should reject hex color without hash', async () => {
      const input: CreateStatusInput = {
        name: 'Valid Name',
        slug: 'valid_slug',
        color: '3b82f6',
        category: 'active',
      }

      const result = await statusService.createStatus(input, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('hex format')
      }
    })

    it('should reject hex color with wrong length', async () => {
      const input: CreateStatusInput = {
        name: 'Valid Name',
        slug: 'valid_slug',
        color: '#3b82f',
        category: 'active',
      }

      const result = await statusService.createStatus(input, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('hex format')
      }
    })

    it('should accept valid hex color with lowercase', async () => {
      const input: CreateStatusInput = {
        name: 'Test',
        slug: 'test',
        color: '#3b82f6',
        category: 'active',
      }

      const mockStatus: Status = {
        id: 'status_1',
        name: 'Test',
        slug: 'test',
        color: '#3b82f6',
        category: 'active',
        position: 0,
        showOnRoadmap: false,
        isDefault: false,
        createdAt: new Date(),
      }

      mockStatusRepoInstance.findBySlug.mockResolvedValue(null)
      mockStatusRepoInstance.create.mockResolvedValue(mockStatus)

      const result = await statusService.createStatus(input, mockContext)

      expect(result.success).toBe(true)
    })

    it('should accept valid hex color with uppercase', async () => {
      const input: CreateStatusInput = {
        name: 'Test',
        slug: 'test',
        color: '#3B82F6',
        category: 'active',
      }

      const mockStatus: Status = {
        id: 'status_1',
        name: 'Test',
        slug: 'test',
        color: '#3B82F6',
        category: 'active',
        position: 0,
        showOnRoadmap: false,
        isDefault: false,
        createdAt: new Date(),
      }

      mockStatusRepoInstance.findBySlug.mockResolvedValue(null)
      mockStatusRepoInstance.create.mockResolvedValue(mockStatus)

      const result = await statusService.createStatus(input, mockContext)

      expect(result.success).toBe(true)
    })

    it('should reject duplicate slug', async () => {
      const input: CreateStatusInput = {
        name: 'New Status',
        slug: 'existing_slug',
        color: '#3b82f6',
        category: 'active',
      }

      const existingStatus: Status = {
        id: 'status_existing',
        name: 'Existing Status',
        slug: 'existing_slug',
        color: '#ef4444',
        category: 'active',
        position: 0,
        showOnRoadmap: false,
        isDefault: false,
        createdAt: new Date(),
      }

      mockStatusRepoInstance.findBySlug.mockResolvedValue(existingStatus)

      const result = await statusService.createStatus(input, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('DUPLICATE_SLUG')
      }
    })

    it('should reject unauthorized user (portal user)', async () => {
      const userContext = { ...mockContext, memberRole: 'user' as const }
      const input: CreateStatusInput = {
        name: 'Status',
        slug: 'status',
        color: '#3b82f6',
        category: 'active',
      }

      const result = await statusService.createStatus(input, userContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('UNAUTHORIZED')
        expect(result.error.message).toContain('create statuses')
      }
    })

    it('should default position to 0 when not provided', async () => {
      const input: CreateStatusInput = {
        name: 'Test',
        slug: 'test',
        color: '#3b82f6',
        category: 'active',
      }

      const mockStatus: Status = {
        id: 'status_1',
        name: 'Test',
        slug: 'test',
        color: '#3b82f6',
        category: 'active',
        position: 0,
        showOnRoadmap: false,
        isDefault: false,
        createdAt: new Date(),
      }

      mockStatusRepoInstance.findBySlug.mockResolvedValue(null)
      mockStatusRepoInstance.create.mockResolvedValue(mockStatus)

      await statusService.createStatus(input, mockContext)

      expect(mockStatusRepoInstance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          position: 0,
        })
      )
    })

    it('should set isDefault and call setDefault when isDefault is true', async () => {
      const input: CreateStatusInput = {
        name: 'Default Status',
        slug: 'default_status',
        color: '#3b82f6',
        category: 'active',
        isDefault: true,
      }

      const mockStatus: Status = {
        id: 'status_1',
        name: 'Default Status',
        slug: 'default_status',
        color: '#3b82f6',
        category: 'active',
        position: 0,
        showOnRoadmap: false,
        isDefault: true,
        createdAt: new Date(),
      }

      mockStatusRepoInstance.findBySlug.mockResolvedValue(null)
      mockStatusRepoInstance.create.mockResolvedValue(mockStatus)
      mockStatusRepoInstance.setDefault.mockResolvedValue(undefined)

      const result = await statusService.createStatus(input, mockContext)

      expect(result.success).toBe(true)
      expect(mockStatusRepoInstance.setDefault).toHaveBeenCalledWith('status_1')
    })

    it('should handle showOnRoadmap flag', async () => {
      const input: CreateStatusInput = {
        name: 'Roadmap Status',
        slug: 'roadmap_status',
        color: '#3b82f6',
        category: 'active',
        showOnRoadmap: true,
      }

      const mockStatus: Status = {
        id: 'status_1',
        name: 'Roadmap Status',
        slug: 'roadmap_status',
        color: '#3b82f6',
        category: 'active',
        position: 0,
        showOnRoadmap: true,
        isDefault: false,
        createdAt: new Date(),
      }

      mockStatusRepoInstance.findBySlug.mockResolvedValue(null)
      mockStatusRepoInstance.create.mockResolvedValue(mockStatus)

      await statusService.createStatus(input, mockContext)

      expect(mockStatusRepoInstance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          showOnRoadmap: true,
        })
      )
    })
  })

  describe('updateStatus', () => {
    const existingStatus: Status = {
      id: 'status_1',
      name: 'Original Name',
      slug: 'original_name',
      color: '#3b82f6',
      category: 'active',
      position: 0,
      showOnRoadmap: false,
      isDefault: false,
      createdAt: new Date(),
    }

    it('should update status name', async () => {
      const input: UpdateStatusInput = {
        name: 'Updated Name',
      }

      const updatedStatus: Status = {
        ...existingStatus,
        name: 'Updated Name',
      }

      mockStatusRepoInstance.findById.mockResolvedValue(existingStatus)
      mockStatusRepoInstance.update.mockResolvedValue(updatedStatus)

      const result = await statusService.updateStatus('status_1', input, mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.name).toBe('Updated Name')
      }
    })

    it('should return error when status not found', async () => {
      const input: UpdateStatusInput = {
        name: 'Updated Name',
      }

      mockStatusRepoInstance.findById.mockResolvedValue(null)

      const result = await statusService.updateStatus('status_nonexistent', input, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('STATUS_NOT_FOUND')
      }
    })

    it('should reject unauthorized user', async () => {
      const userContext = { ...mockContext, memberRole: 'user' as const }
      const input: UpdateStatusInput = {
        name: 'Updated Name',
      }

      mockStatusRepoInstance.findById.mockResolvedValue(existingStatus)

      const result = await statusService.updateStatus('status_1', input, userContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('UNAUTHORIZED')
        expect(result.error.message).toContain('update statuses')
      }
    })

    it('should reject empty name', async () => {
      const input: UpdateStatusInput = {
        name: '   ',
      }

      mockStatusRepoInstance.findById.mockResolvedValue(existingStatus)

      const result = await statusService.updateStatus('status_1', input, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('cannot be empty')
      }
    })

    it('should reject name longer than 50 characters', async () => {
      const input: UpdateStatusInput = {
        name: 'a'.repeat(51),
      }

      mockStatusRepoInstance.findById.mockResolvedValue(existingStatus)

      const result = await statusService.updateStatus('status_1', input, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('50 characters')
      }
    })

    it('should update color', async () => {
      const input: UpdateStatusInput = {
        color: '#ef4444',
      }

      const updatedStatus: Status = {
        ...existingStatus,
        color: '#ef4444',
      }

      mockStatusRepoInstance.findById.mockResolvedValue(existingStatus)
      mockStatusRepoInstance.update.mockResolvedValue(updatedStatus)

      const result = await statusService.updateStatus('status_1', input, mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.color).toBe('#ef4444')
      }
    })

    it('should reject empty color', async () => {
      const input: UpdateStatusInput = {
        color: '   ',
      }

      mockStatusRepoInstance.findById.mockResolvedValue(existingStatus)

      const result = await statusService.updateStatus('status_1', input, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('cannot be empty')
      }
    })

    it('should reject invalid hex color', async () => {
      const input: UpdateStatusInput = {
        color: 'invalid',
      }

      mockStatusRepoInstance.findById.mockResolvedValue(existingStatus)

      const result = await statusService.updateStatus('status_1', input, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('hex format')
      }
    })

    it('should update showOnRoadmap flag', async () => {
      const input: UpdateStatusInput = {
        showOnRoadmap: true,
      }

      const updatedStatus: Status = {
        ...existingStatus,
        showOnRoadmap: true,
      }

      mockStatusRepoInstance.findById.mockResolvedValue(existingStatus)
      mockStatusRepoInstance.update.mockResolvedValue(updatedStatus)

      await statusService.updateStatus('status_1', input, mockContext)

      expect(mockStatusRepoInstance.update).toHaveBeenCalledWith(
        'status_1',
        expect.objectContaining({
          showOnRoadmap: true,
        })
      )
    })

    it('should call setDefault when isDefault is true', async () => {
      const input: UpdateStatusInput = {
        isDefault: true,
      }

      const updatedStatus: Status = {
        ...existingStatus,
        isDefault: true,
      }

      mockStatusRepoInstance.findById.mockResolvedValue(existingStatus)
      mockStatusRepoInstance.setDefault.mockResolvedValue(undefined)
      mockStatusRepoInstance.update.mockResolvedValue(updatedStatus)

      const result = await statusService.updateStatus('status_1', input, mockContext)

      expect(mockStatusRepoInstance.setDefault).toHaveBeenCalledWith('status_1')
      expect(result.success).toBe(true)
    })

    it('should unset isDefault when explicitly set to false', async () => {
      const defaultStatus: Status = {
        ...existingStatus,
        isDefault: true,
      }

      const input: UpdateStatusInput = {
        isDefault: false,
      }

      const updatedStatus: Status = {
        ...existingStatus,
        isDefault: false,
      }

      mockStatusRepoInstance.findById.mockResolvedValue(defaultStatus)
      mockStatusRepoInstance.update.mockResolvedValue(updatedStatus)

      await statusService.updateStatus('status_1', input, mockContext)

      expect(mockStatusRepoInstance.update).toHaveBeenCalledWith(
        'status_1',
        expect.objectContaining({
          isDefault: false,
        })
      )
    })
  })

  describe('deleteStatus', () => {
    const existingStatus: Status = {
      id: 'status_1',
      name: 'Status to Delete',
      slug: 'status_to_delete',
      color: '#3b82f6',
      category: 'active',
      position: 0,
      showOnRoadmap: false,
      isDefault: false,
      createdAt: new Date(),
    }

    it('should delete status when not in use', async () => {
      mockStatusRepoInstance.findById.mockResolvedValue(existingStatus)
      mockDbInstance.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 0 }]),
        }),
      })
      mockStatusRepoInstance.delete.mockResolvedValue(true)

      const result = await statusService.deleteStatus('status_1', mockContext)

      expect(result.success).toBe(true)
      expect(mockStatusRepoInstance.delete).toHaveBeenCalledWith('status_1')
    })

    it('should return error when status not found', async () => {
      mockStatusRepoInstance.findById.mockResolvedValue(null)

      const result = await statusService.deleteStatus('status_nonexistent', mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('STATUS_NOT_FOUND')
      }
    })

    it('should reject unauthorized user', async () => {
      const userContext = { ...mockContext, memberRole: 'user' as const }

      mockStatusRepoInstance.findById.mockResolvedValue(existingStatus)

      const result = await statusService.deleteStatus('status_1', userContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('UNAUTHORIZED')
        expect(result.error.message).toContain('delete statuses')
      }
    })

    it('should reject deleting default status', async () => {
      const defaultStatus: Status = {
        ...existingStatus,
        isDefault: true,
      }

      mockStatusRepoInstance.findById.mockResolvedValue(defaultStatus)

      const result = await statusService.deleteStatus('status_1', mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('CANNOT_DELETE_DEFAULT')
        expect(result.error.message).toContain('default status')
      }
    })

    it('should reject deleting status in use', async () => {
      mockStatusRepoInstance.findById.mockResolvedValue(existingStatus)
      mockDbInstance.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 5 }]),
        }),
      })

      const result = await statusService.deleteStatus('status_1', mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('CANNOT_DELETE_IN_USE')
        expect(result.error.message).toContain('5 post(s)')
      }
    })
  })

  describe('getStatusById', () => {
    it('should return status when found', async () => {
      const mockStatus: Status = {
        id: 'status_1',
        name: 'Test Status',
        slug: 'test_status',
        color: '#3b82f6',
        category: 'active',
        position: 0,
        showOnRoadmap: false,
        isDefault: false,
        createdAt: new Date(),
      }

      mockStatusRepoInstance.findById.mockResolvedValue(mockStatus)

      const result = await statusService.getStatusById('status_1', mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.id).toBe('status_1')
        expect(result.value.name).toBe('Test Status')
      }
    })

    it('should return error when status not found', async () => {
      mockStatusRepoInstance.findById.mockResolvedValue(null)

      const result = await statusService.getStatusById('status_nonexistent', mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('STATUS_NOT_FOUND')
      }
    })
  })

  describe('listStatuses', () => {
    it('should return all statuses ordered by category and position', async () => {
      const mockStatuses: Status[] = [
        {
          id: 'status_1',
          name: 'Open',
          slug: 'open',
          color: '#3b82f6',
          category: 'active',
          position: 0,
          showOnRoadmap: false,
          isDefault: true,
          createdAt: new Date(),
        },
        {
          id: 'status_2',
          name: 'Complete',
          slug: 'complete',
          color: '#10b981',
          category: 'complete',
          position: 0,
          showOnRoadmap: false,
          isDefault: false,
          createdAt: new Date(),
        },
      ]

      mockStatusRepoInstance.findAll.mockResolvedValue(mockStatuses)

      const result = await statusService.listStatuses(mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toHaveLength(2)
        expect(result.value[0].category).toBe('active')
        expect(result.value[1].category).toBe('complete')
      }
    })

    it('should return empty array when no statuses exist', async () => {
      mockStatusRepoInstance.findAll.mockResolvedValue([])

      const result = await statusService.listStatuses(mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toHaveLength(0)
      }
    })
  })

  describe('reorderStatuses', () => {
    it('should reorder statuses successfully', async () => {
      const statusIds: StatusId[] = [
        'status_3' as StatusId,
        'status_1' as StatusId,
        'status_2' as StatusId,
      ]

      mockStatusRepoInstance.reorder.mockResolvedValue(undefined)

      const result = await statusService.reorderStatuses(statusIds, mockContext)

      expect(result.success).toBe(true)
      expect(mockStatusRepoInstance.reorder).toHaveBeenCalledWith(statusIds)
    })

    it('should reject unauthorized user', async () => {
      const userContext = { ...mockContext, memberRole: 'user' as const }
      const statusIds: StatusId[] = ['status_1' as StatusId, 'status_2' as StatusId]

      const result = await statusService.reorderStatuses(statusIds, userContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('UNAUTHORIZED')
        expect(result.error.message).toContain('reorder statuses')
      }
    })

    it('should reject empty status IDs array', async () => {
      const result = await statusService.reorderStatuses([], mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('required')
      }
    })
  })

  describe('setDefaultStatus', () => {
    const existingStatus: Status = {
      id: 'status_1',
      name: 'Status',
      slug: 'status',
      color: '#3b82f6',
      category: 'active',
      position: 0,
      showOnRoadmap: false,
      isDefault: false,
      createdAt: new Date(),
    }

    it('should set status as default', async () => {
      const updatedStatus: Status = {
        ...existingStatus,
        isDefault: true,
      }

      mockStatusRepoInstance.findById
        .mockResolvedValueOnce(existingStatus)
        .mockResolvedValueOnce(updatedStatus)
      mockStatusRepoInstance.setDefault.mockResolvedValue(undefined)

      const result = await statusService.setDefaultStatus('status_1', mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.isDefault).toBe(true)
      }
      expect(mockStatusRepoInstance.setDefault).toHaveBeenCalledWith('status_1')
    })

    it('should return error when status not found', async () => {
      mockStatusRepoInstance.findById.mockResolvedValue(null)

      const result = await statusService.setDefaultStatus('status_nonexistent', mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('STATUS_NOT_FOUND')
      }
    })

    it('should reject unauthorized user', async () => {
      const userContext = { ...mockContext, memberRole: 'user' as const }

      mockStatusRepoInstance.findById.mockResolvedValue(existingStatus)

      const result = await statusService.setDefaultStatus('status_1', userContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('UNAUTHORIZED')
        expect(result.error.message).toContain('set default status')
      }
    })
  })

  describe('getDefaultStatus', () => {
    it('should return default status when it exists', async () => {
      const defaultStatus: Status = {
        id: 'status_1',
        name: 'Open',
        slug: 'open',
        color: '#3b82f6',
        category: 'active',
        position: 0,
        showOnRoadmap: false,
        isDefault: true,
        createdAt: new Date(),
      }

      mockStatusRepoInstance.findDefault.mockResolvedValue(defaultStatus)

      const result = await statusService.getDefaultStatus(mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value?.isDefault).toBe(true)
      }
    })

    it('should return null when no default status exists', async () => {
      mockStatusRepoInstance.findDefault.mockResolvedValue(null)

      const result = await statusService.getDefaultStatus(mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toBeNull()
      }
    })
  })

  describe('getStatusBySlug', () => {
    it('should return status when found by slug', async () => {
      const mockStatus: Status = {
        id: 'status_1',
        name: 'Test Status',
        slug: 'test_status',
        color: '#3b82f6',
        category: 'active',
        position: 0,
        showOnRoadmap: false,
        isDefault: false,
        createdAt: new Date(),
      }

      mockStatusRepoInstance.findBySlug.mockResolvedValue(mockStatus)

      const result = await statusService.getStatusBySlug('test_status', mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.slug).toBe('test_status')
      }
    })

    it('should return error when status not found by slug', async () => {
      mockStatusRepoInstance.findBySlug.mockResolvedValue(null)

      const result = await statusService.getStatusBySlug('status_nonexistent', mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('STATUS_NOT_FOUND')
      }
    })
  })

  describe('seedDefaultStatuses', () => {
    it('should seed default statuses for new organization', async () => {
      const mockStatuses: Status[] = [
        {
          id: 'status_1',
          name: 'Open',
          slug: 'open',
          color: '#3b82f6',
          category: 'active',
          position: 0,
          showOnRoadmap: false,
          isDefault: true,
          createdAt: new Date(),
        },
      ]

      const { db } = await import('@quackback/db')
      vi.mocked(db.insert).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue(mockStatuses),
        }),
      } as unknown as ReturnType<typeof db.insert>)

      const result = await statusService.seedDefaultStatuses('org-new')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toHaveLength(1)
      }
    })

    it('should handle errors during seeding', async () => {
      const { db } = await import('@quackback/db')
      vi.mocked(db.insert).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockRejectedValue(new Error('Database error')),
        }),
      } as unknown as ReturnType<typeof db.insert>)

      const result = await statusService.seedDefaultStatuses('org-new')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('Database error')
      }
    })
  })

  describe('listPublicStatuses', () => {
    it('should return statuses without authentication', async () => {
      const mockStatuses: Status[] = [
        {
          id: 'status_1',
          name: 'Open',
          slug: 'open',
          color: '#3b82f6',
          category: 'active',
          position: 0,
          showOnRoadmap: false,
          isDefault: true,
          createdAt: new Date(),
        },
        {
          id: 'status_2',
          name: 'Complete',
          slug: 'complete',
          color: '#10b981',
          category: 'complete',
          position: 0,
          showOnRoadmap: false,
          isDefault: false,
          createdAt: new Date(),
        },
      ]

      const { db } = await import('@quackback/db')
      vi.mocked(db.query.postStatuses.findMany).mockResolvedValue(mockStatuses)

      const result = await statusService.listPublicStatuses('org-123')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toHaveLength(2)
        expect(result.value[0].name).toBe('Open')
        expect(result.value[1].name).toBe('Complete')
      }
    })

    it('should return empty array when no statuses exist', async () => {
      const { db } = await import('@quackback/db')
      vi.mocked(db.query.postStatuses.findMany).mockResolvedValue([])

      const result = await statusService.listPublicStatuses('org-123')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toHaveLength(0)
      }
    })

    it('should handle database errors', async () => {
      const { db } = await import('@quackback/db')
      vi.mocked(db.query.postStatuses.findMany).mockRejectedValue(new Error('Database error'))

      const result = await statusService.listPublicStatuses('org-123')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('Database error')
      }
    })
  })
})
