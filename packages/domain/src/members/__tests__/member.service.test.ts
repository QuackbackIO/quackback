import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemberService, type TeamMember } from '../member.service'
import type { Member } from '@quackback/db'

// Mock dependencies - must be hoisted for vi.mock to access
const { mockMemberRepo, mockDb } = vi.hoisted(() => ({
  mockMemberRepo: {
    findByUser: vi.fn(),
    findById: vi.fn(),
  },
  mockDb: {
    select: vi.fn(),
    query: {
      member: {
        findFirst: vi.fn(),
      },
    },
  },
}))

vi.mock('@quackback/db', () => ({
  db: mockDb,
  MemberRepository: vi.fn(function () {
    return mockMemberRepo
  }),
  eq: vi.fn((...args) => ({ eq: args })),
  and: vi.fn((...args) => ({ and: args })),
  sql: vi.fn((strings, ...values) => ({ sql: { strings, values }, as: vi.fn() })),
  member: {
    userId: 'userId',
  },
  user: {
    id: 'id',
    name: 'name',
    email: 'email',
    image: 'image',
  },
}))

describe('MemberService', () => {
  let memberService: MemberService

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    memberService = new MemberService()
  })

  describe('getMemberByUser', () => {
    it('should return member when found', async () => {
      const mockMember: Member = {
        id: 'member_123',
        userId: 'user-123',
        role: 'admin',
        createdAt: new Date(),
      }

      mockMemberRepo.findByUser.mockResolvedValue(mockMember)

      const result = await memberService.getMemberByUser('user-123')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toEqual(mockMember)
      }
      expect(mockMemberRepo.findByUser).toHaveBeenCalledWith('user-123')
    })

    it('should return null when member not found', async () => {
      mockMemberRepo.findByUser.mockResolvedValue(null)

      const result = await memberService.getMemberByUser('user-123')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toBeNull()
      }
    })

    it('should return error when database operation fails', async () => {
      mockMemberRepo.findByUser.mockRejectedValue(new Error('Database error'))

      const result = await memberService.getMemberByUser('user-123')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('DATABASE_ERROR')
        expect(result.error.message).toBe('Failed to lookup member')
      }
    })

    it('should work with different user IDs', async () => {
      const mockMember: Member = {
        id: 'member_456',
        userId: 'user-456',
        role: 'member',
        createdAt: new Date(),
      }

      mockMemberRepo.findByUser.mockResolvedValue(mockMember)

      const result = await memberService.getMemberByUser('user-456')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value?.userId).toBe('user-456')
      }
    })
  })

  describe('getMemberById', () => {
    it('should return member when found', async () => {
      const mockMember: Member = {
        id: 'member_123',
        userId: 'user-123',
        role: 'admin',
        createdAt: new Date(),
      }

      mockMemberRepo.findById.mockResolvedValue(mockMember)

      const result = await memberService.getMemberById('member_123')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toEqual(mockMember)
      }
      expect(mockMemberRepo.findById).toHaveBeenCalledWith('member_123')
    })

    it('should return null when member not found', async () => {
      mockMemberRepo.findById.mockResolvedValue(null)

      const result = await memberService.getMemberById('member_nonexistent')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toBeNull()
      }
    })

    it('should return error when database operation fails', async () => {
      mockMemberRepo.findById.mockRejectedValue(new Error('Database error'))

      const result = await memberService.getMemberById('member_123')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('DATABASE_ERROR')
        expect(result.error.message).toBe('Failed to lookup member')
      }
    })
  })

  describe('listTeamMembers', () => {
    it('should return team members with user details', async () => {
      const mockTeamMembers: TeamMember[] = [
        {
          id: 'user-1',
          name: 'John Doe',
          email: 'john@example.com',
          image: 'https://example.com/avatar1.jpg',
        },
        {
          id: 'user-2',
          name: 'Jane Smith',
          email: 'jane@example.com',
          image: null,
        },
      ]

      const mockSelectChain = {
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockResolvedValue(mockTeamMembers),
      }

      mockDb.select.mockReturnValue(mockSelectChain)

      const result = await memberService.listTeamMembers()

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toHaveLength(2)
        expect(result.value[0]).toEqual(mockTeamMembers[0])
        expect(result.value[1].image).toBeNull()
      }
    })

    it('should return empty array when no members exist', async () => {
      const mockSelectChain = {
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockResolvedValue([]),
      }

      mockDb.select.mockReturnValue(mockSelectChain)

      const result = await memberService.listTeamMembers()

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toHaveLength(0)
      }
    })

    it('should return error when database operation fails', async () => {
      const mockSelectChain = {
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockRejectedValue(new Error('Database error')),
      }

      mockDb.select.mockReturnValue(mockSelectChain)

      const result = await memberService.listTeamMembers()

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('DATABASE_ERROR')
        expect(result.error.message).toBe('Failed to list team members')
      }
    })

    it('should handle members with null names', async () => {
      const mockTeamMembers: TeamMember[] = [
        {
          id: 'user-1',
          name: null,
          email: 'john@example.com',
          image: null,
        },
      ]

      const mockSelectChain = {
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockResolvedValue(mockTeamMembers),
      }

      mockDb.select.mockReturnValue(mockSelectChain)

      const result = await memberService.listTeamMembers()

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value[0].name).toBeNull()
      }
    })
  })

  describe('countMembers', () => {
    it('should return member count', async () => {
      const mockSelectChain = {
        from: vi.fn().mockResolvedValue([{ count: 5 }]),
      }

      mockDb.select.mockReturnValue(mockSelectChain)

      const result = await memberService.countMembers()

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toBe(5)
      }
    })

    it('should return 0 when no members exist', async () => {
      const mockSelectChain = {
        from: vi.fn().mockResolvedValue([{ count: 0 }]),
      }

      mockDb.select.mockReturnValue(mockSelectChain)

      const result = await memberService.countMembers()

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toBe(0)
      }
    })

    it('should return 0 when result is empty', async () => {
      const mockSelectChain = {
        from: vi.fn().mockResolvedValue([]),
      }

      mockDb.select.mockReturnValue(mockSelectChain)

      const result = await memberService.countMembers()

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toBe(0)
      }
    })

    it('should return error when database operation fails', async () => {
      const mockSelectChain = {
        from: vi.fn().mockRejectedValue(new Error('Database error')),
      }

      mockDb.select.mockReturnValue(mockSelectChain)

      const result = await memberService.countMembers()

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('DATABASE_ERROR')
        expect(result.error.message).toBe('Failed to count members')
      }
    })

    it('should handle large member counts', async () => {
      const mockSelectChain = {
        from: vi.fn().mockResolvedValue([{ count: 1000 }]),
      }

      mockDb.select.mockReturnValue(mockSelectChain)

      const result = await memberService.countMembers()

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toBe(1000)
      }
    })
  })

  describe('checkMembership', () => {
    it('should return isMember true with member data when user is member', async () => {
      const mockMember: Member = {
        id: 'member_123',
        userId: 'user-123',
        role: 'admin',
        createdAt: new Date(),
      }

      mockDb.query.member.findFirst.mockResolvedValue(mockMember)

      const result = await memberService.checkMembership('user-123')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.isMember).toBe(true)
        expect(result.value.member).toEqual(mockMember)
      }
    })

    it('should return isMember false when user is not member', async () => {
      mockDb.query.member.findFirst.mockResolvedValue(undefined)

      const result = await memberService.checkMembership('user-123')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.isMember).toBe(false)
        expect(result.value.member).toBeUndefined()
      }
    })

    it('should return error when database operation fails', async () => {
      mockDb.query.member.findFirst.mockRejectedValue(new Error('Database error'))

      const result = await memberService.checkMembership('user-123')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('DATABASE_ERROR')
        expect(result.error.message).toBe('Failed to check membership')
      }
    })

    it('should check membership for different users', async () => {
      const mockMember: Member = {
        id: 'member_456',
        userId: 'user-456',
        role: 'member',
        createdAt: new Date(),
      }

      mockDb.query.member.findFirst.mockResolvedValue(mockMember)

      const result = await memberService.checkMembership('user-456')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.isMember).toBe(true)
        expect(result.value.member?.role).toBe('member')
      }
    })

    it('should handle owner role correctly', async () => {
      const mockMember: Member = {
        id: 'member_789',
        userId: 'user-789',
        role: 'owner',
        createdAt: new Date(),
      }

      mockDb.query.member.findFirst.mockResolvedValue(mockMember)

      const result = await memberService.checkMembership('user-789')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.isMember).toBe(true)
        expect(result.value.member?.role).toBe('owner')
      }
    })

    it('should handle team member role correctly', async () => {
      const mockMember: Member = {
        id: 'member_999',
        userId: 'user-999',
        role: 'member',
        createdAt: new Date(),
      }

      mockDb.query.member.findFirst.mockResolvedValue(mockMember)

      const result = await memberService.checkMembership('user-999')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.isMember).toBe(true)
        expect(result.value.member?.role).toBe('member')
      }
    })

    it('should return isMember=false for users without member record', async () => {
      // Users without a member record (e.g., unauthenticated visitors)
      mockDb.query.member.findFirst.mockResolvedValue(null)

      const result = await memberService.checkMembership('user-999')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.isMember).toBe(false)
        expect(result.value.member).toBeFalsy() // undefined or null
      }
    })
  })
})
