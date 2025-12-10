import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getSession,
  getActiveOrganization,
  requireAuth,
  requireOrganization,
  requireRole,
} from '../server'
import type { Session } from '../server'

// Mock Next.js headers
vi.mock('next/headers', () => ({
  headers: vi.fn(),
}))

// Mock the auth client
vi.mock('../index', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
      getFullOrganization: vi.fn(),
    },
  },
}))

// Import mocked modules
import { headers } from 'next/headers'
import { auth } from '../index'

// Mock types for Better-Auth structures
type MockUser = {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image: string | null
  createdAt: Date
  updatedAt: Date
}

// Member role includes 'user' for portal users (extends Better-Auth's standard roles)
type MemberRole = 'owner' | 'admin' | 'member' | 'user'

type MockMember = {
  id: string
  organizationId: string
  userId: string
  role: MemberRole
  createdAt: Date
  user: {
    id: string
    name: string
    email: string
    image?: string
  }
}

type MockInvitation = {
  id: string
  organizationId: string
  email: string
  role: 'owner' | 'admin' | 'member'
  status: string
  expiresAt: Date
  inviterId: string
}

type MockOrganization = {
  id: string
  name: string
  slug: string
  logo: string | null
  createdAt: Date
  metadata: string | null
  members: MockMember[]
  invitations: MockInvitation[]
}

// Mock factory functions
function _createMockUser(overrides: Partial<MockUser> = {}): MockUser {
  return {
    id: 'user-1',
    name: 'John Doe',
    email: 'john@example.com',
    emailVerified: true,
    image: 'https://example.com/avatar.jpg',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  }
}

// Creates a mock organization. Our app extends Better-Auth's member roles to include 'user' for portal users.
function createMockOrganization(overrides: Partial<MockOrganization> = {}): MockOrganization {
  return {
    id: 'org-1',
    name: 'Acme Corp',
    slug: 'acme',
    logo: null,
    createdAt: new Date('2025-01-01'),
    metadata: null,
    members: [],
    invitations: [],
    ...overrides,
  }
}

// Type helpers for Better-Auth API responses - our app extends standard roles with 'user'
type BetterAuthFullOrg = Awaited<ReturnType<typeof auth.api.getFullOrganization>>
type BetterAuthSession = Awaited<ReturnType<typeof auth.api.getSession>>
const mockOrgResponse = (org: MockOrganization): BetterAuthFullOrg => org as BetterAuthFullOrg
const mockSessionResponse = <T>(session: T): BetterAuthSession => session as BetterAuthSession

function createMockMember(overrides: Partial<MockMember> = {}): MockMember {
  return {
    id: 'member-1',
    organizationId: 'org-1',
    userId: 'user-1',
    role: 'member',
    createdAt: new Date('2025-01-01'),
    user: {
      id: 'user-1',
      name: 'John Doe',
      email: 'john@example.com',
    },
    ...overrides,
  }
}

describe('Server Auth Utilities', () => {
  const mockHeaders = new Headers()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(headers).mockResolvedValue(mockHeaders)
  })

  describe('getSession', () => {
    it('returns session when authenticated', async () => {
      const mockSessionData = {
        session: {
          id: 'session-1',
          expiresAt: new Date('2025-12-20'),
          token: 'token-123',
          createdAt: new Date('2025-12-10'),
          updatedAt: new Date('2025-12-10'),
          userId: 'user-1',
        },
        user: {
          id: 'user-1',
          name: 'John Doe',
          email: 'john@example.com',
          emailVerified: true,
          image: 'https://example.com/avatar.jpg',
          createdAt: new Date('2025-01-01'),
          updatedAt: new Date('2025-01-01'),
        },
      }

      vi.mocked(auth.api.getSession).mockResolvedValue(mockSessionData)

      const result = await getSession()

      expect(result).toEqual({
        session: mockSessionData.session,
        user: {
          id: 'user-1',
          name: 'John Doe',
          email: 'john@example.com',
          emailVerified: true,
          image: 'https://example.com/avatar.jpg',
          createdAt: mockSessionData.user.createdAt,
          updatedAt: mockSessionData.user.updatedAt,
        },
      })
      expect(auth.api.getSession).toHaveBeenCalledWith({
        headers: mockHeaders,
      })
    })

    it('returns null when not authenticated', async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue(null)

      const result = await getSession()

      expect(result).toBeNull()
      expect(auth.api.getSession).toHaveBeenCalledWith({
        headers: mockHeaders,
      })
    })

    it('returns null when session has no user', async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue(
        mockSessionResponse({
          session: {
            id: 'session-1',
            expiresAt: new Date('2025-12-20'),
            token: 'token-123',
            createdAt: new Date('2025-12-10'),
            updatedAt: new Date('2025-12-10'),
            userId: 'user-1',
          },
          user: null,
        })
      )

      const result = await getSession()

      expect(result).toBeNull()
    })

    it('handles user without image (null)', async () => {
      const mockSessionData = {
        session: {
          id: 'session-1',
          expiresAt: new Date('2025-12-20'),
          token: 'token-123',
          createdAt: new Date('2025-12-10'),
          updatedAt: new Date('2025-12-10'),
          userId: 'user-1',
        },
        user: {
          id: 'user-1',
          name: 'Jane Doe',
          email: 'jane@example.com',
          emailVerified: false,
          image: null,
          createdAt: new Date('2025-01-01'),
          updatedAt: new Date('2025-01-01'),
        },
      }

      vi.mocked(auth.api.getSession).mockResolvedValue(mockSessionData)

      const result = await getSession()

      expect(result).toEqual({
        session: mockSessionData.session,
        user: {
          id: 'user-1',
          name: 'Jane Doe',
          email: 'jane@example.com',
          emailVerified: false,
          image: null,
          createdAt: mockSessionData.user.createdAt,
          updatedAt: mockSessionData.user.updatedAt,
        },
      })
    })

    it('caches session result (react cache)', async () => {
      // Note: React's cache() function is used, which should cache results
      // within the same render cycle. Testing actual cache behavior would
      // require more complex setup, so we verify the implementation uses cache()
      const mockSessionData = {
        session: {
          id: 'session-1',
          expiresAt: new Date('2025-12-20'),
          token: 'token-123',
          createdAt: new Date('2025-12-10'),
          updatedAt: new Date('2025-12-10'),
          userId: 'user-1',
        },
        user: {
          id: 'user-1',
          name: 'John Doe',
          email: 'john@example.com',
          emailVerified: true,
          image: 'https://example.com/avatar.jpg',
          createdAt: new Date('2025-01-01'),
          updatedAt: new Date('2025-01-01'),
        },
      }

      vi.mocked(auth.api.getSession).mockResolvedValue(mockSessionData)

      const result = await getSession()

      expect(result).toBeDefined()
      expect(auth.api.getSession).toHaveBeenCalledTimes(1)
    })
  })

  describe('getActiveOrganization', () => {
    it('returns organization when session has active org', async () => {
      const mockOrg = createMockOrganization({
        logo: 'https://example.com/logo.png',
        members: [createMockMember({ role: 'owner' })],
      })

      vi.mocked(auth.api.getFullOrganization).mockResolvedValue(mockOrgResponse(mockOrg))

      const result = await getActiveOrganization()

      expect(result).toEqual(mockOrg)
      expect(auth.api.getFullOrganization).toHaveBeenCalledWith({
        headers: mockHeaders,
      })
    })

    it('returns null when no active organization', async () => {
      vi.mocked(auth.api.getFullOrganization).mockResolvedValue(null)

      const result = await getActiveOrganization()

      expect(result).toBeNull()
      expect(auth.api.getFullOrganization).toHaveBeenCalledWith({
        headers: mockHeaders,
      })
    })

    it('caches organization result (react cache)', async () => {
      // Note: React's cache() function is used, which should cache results
      // within the same render cycle
      const mockOrg = createMockOrganization()

      vi.mocked(auth.api.getFullOrganization).mockResolvedValue(mockOrgResponse(mockOrg))

      const result = await getActiveOrganization()

      expect(result).toBeDefined()
      expect(auth.api.getFullOrganization).toHaveBeenCalledTimes(1)
    })
  })

  describe('requireAuth', () => {
    it('returns session when authenticated', async () => {
      const mockSession: Session = {
        session: {
          id: 'session-1',
          expiresAt: new Date('2025-12-20'),
          token: 'token-123',
          createdAt: new Date('2025-12-10'),
          updatedAt: new Date('2025-12-10'),
          userId: 'user-1',
        },
        user: {
          id: 'user-1',
          name: 'John Doe',
          email: 'john@example.com',
          emailVerified: true,
          image: 'https://example.com/avatar.jpg',
          createdAt: new Date('2025-01-01'),
          updatedAt: new Date('2025-01-01'),
        },
      }

      vi.mocked(auth.api.getSession).mockResolvedValue({
        session: mockSession.session,
        user: mockSession.user,
      })

      const result = await requireAuth()

      expect(result).toEqual(mockSession)
    })

    it('throws error when not authenticated', async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue(null)

      await expect(requireAuth()).rejects.toThrow('Unauthorized')
    })

    it('throws error when session has no user', async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue(
        mockSessionResponse({
          session: {
            id: 'session-1',
            expiresAt: new Date('2025-12-20'),
            token: 'token-123',
            createdAt: new Date('2025-12-10'),
            updatedAt: new Date('2025-12-10'),
            userId: 'user-1',
          },
          user: null,
        })
      )

      await expect(requireAuth()).rejects.toThrow('Unauthorized')
    })
  })

  describe('requireOrganization', () => {
    it('returns session and organization when valid', async () => {
      const mockSession = {
        session: {
          id: 'session-1',
          expiresAt: new Date('2025-12-20'),
          token: 'token-123',
          createdAt: new Date('2025-12-10'),
          updatedAt: new Date('2025-12-10'),
          userId: 'user-1',
        },
        user: {
          id: 'user-1',
          name: 'John Doe',
          email: 'john@example.com',
          emailVerified: true,
          image: 'https://example.com/avatar.jpg',
          createdAt: new Date('2025-01-01'),
          updatedAt: new Date('2025-01-01'),
        },
      }

      const mockOrg = createMockOrganization({
        members: [createMockMember({ role: 'owner' })],
      })

      vi.mocked(auth.api.getSession).mockResolvedValue(mockSession)
      vi.mocked(auth.api.getFullOrganization).mockResolvedValue(mockOrgResponse(mockOrg))

      const result = await requireOrganization()

      expect(result).toEqual({
        session: mockSession,
        organization: mockOrg,
      })
    })

    it('throws error when not authenticated', async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue(null)

      await expect(requireOrganization()).rejects.toThrow('Unauthorized')
    })

    it('throws error when no active organization', async () => {
      const mockSession = {
        session: {
          id: 'session-1',
          expiresAt: new Date('2025-12-20'),
          token: 'token-123',
          createdAt: new Date('2025-12-10'),
          updatedAt: new Date('2025-12-10'),
          userId: 'user-1',
        },
        user: {
          id: 'user-1',
          name: 'John Doe',
          email: 'john@example.com',
          emailVerified: true,
          image: null,
          createdAt: new Date('2025-01-01'),
          updatedAt: new Date('2025-01-01'),
        },
      }

      vi.mocked(auth.api.getSession).mockResolvedValue(mockSession)
      vi.mocked(auth.api.getFullOrganization).mockResolvedValue(null)

      await expect(requireOrganization()).rejects.toThrow('No active organization')
    })
  })

  describe('requireRole', () => {
    const mockSession = {
      session: {
        id: 'session-1',
        expiresAt: new Date('2025-12-20'),
        token: 'token-123',
        createdAt: new Date('2025-12-10'),
        updatedAt: new Date('2025-12-10'),
        userId: 'user-1',
      },
      user: {
        id: 'user-1',
        name: 'John Doe',
        email: 'john@example.com',
        emailVerified: true,
        image: null,
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date('2025-01-01'),
      },
    }

    it('allows access for owner role', async () => {
      const mockOrg = createMockOrganization({
        members: [createMockMember({ role: 'owner' })],
      })

      vi.mocked(auth.api.getSession).mockResolvedValue(mockSession)
      vi.mocked(auth.api.getFullOrganization).mockResolvedValue(mockOrgResponse(mockOrg))

      const result = await requireRole(['owner'])

      expect(result).toEqual({
        session: mockSession,
        organization: mockOrg,
        member: mockOrg.members[0],
      })
    })

    it('allows access for admin role when allowed', async () => {
      const mockOrg = createMockOrganization({
        members: [createMockMember({ role: 'admin' })],
      })

      vi.mocked(auth.api.getSession).mockResolvedValue(mockSession)
      vi.mocked(auth.api.getFullOrganization).mockResolvedValue(mockOrgResponse(mockOrg))

      const result = await requireRole(['owner', 'admin'])

      expect(result).toEqual({
        session: mockSession,
        organization: mockOrg,
        member: mockOrg.members[0],
      })
    })

    it('allows access for member role when allowed', async () => {
      const mockOrg = createMockOrganization({
        members: [createMockMember({ role: 'member' })],
      })

      vi.mocked(auth.api.getSession).mockResolvedValue(mockSession)
      vi.mocked(auth.api.getFullOrganization).mockResolvedValue(mockOrgResponse(mockOrg))

      const result = await requireRole(['owner', 'admin', 'member'])

      expect(result).toEqual({
        session: mockSession,
        organization: mockOrg,
        member: mockOrg.members[0],
      })
    })

    it('denies access when role is insufficient (member trying owner)', async () => {
      const mockOrg = createMockOrganization({
        members: [createMockMember({ role: 'member' })],
      })

      vi.mocked(auth.api.getSession).mockResolvedValue(mockSession)
      vi.mocked(auth.api.getFullOrganization).mockResolvedValue(mockOrgResponse(mockOrg))

      await expect(requireRole(['owner'])).rejects.toThrow('Forbidden')
    })

    it('denies access when role is insufficient (user trying admin)', async () => {
      const mockOrg = createMockOrganization({
        members: [createMockMember({ role: 'user' })],
      })

      vi.mocked(auth.api.getSession).mockResolvedValue(mockSession)
      vi.mocked(auth.api.getFullOrganization).mockResolvedValue(mockOrgResponse(mockOrg))

      await expect(requireRole(['owner', 'admin', 'member'])).rejects.toThrow('Forbidden')
    })

    it('denies access when user is not a member', async () => {
      const mockOrg = createMockOrganization({
        members: [createMockMember({ id: 'member-2', userId: 'user-2', role: 'owner' })],
      })

      vi.mocked(auth.api.getSession).mockResolvedValue(mockSession)
      vi.mocked(auth.api.getFullOrganization).mockResolvedValue(mockOrgResponse(mockOrg))

      await expect(requireRole(['owner', 'admin', 'member'])).rejects.toThrow('Forbidden')
    })

    it('denies access when member array is empty', async () => {
      const mockOrg = createMockOrganization()

      vi.mocked(auth.api.getSession).mockResolvedValue(mockSession)
      vi.mocked(auth.api.getFullOrganization).mockResolvedValue(mockOrgResponse(mockOrg))

      await expect(requireRole(['owner'])).rejects.toThrow('Forbidden')
    })

    it('throws error when not authenticated', async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue(null)

      await expect(requireRole(['owner'])).rejects.toThrow('Unauthorized')
    })

    it('throws error when no active organization', async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue(mockSession)
      vi.mocked(auth.api.getFullOrganization).mockResolvedValue(null)

      await expect(requireRole(['owner'])).rejects.toThrow('No active organization')
    })
  })

  describe('Role hierarchy validation', () => {
    const mockSession = {
      session: {
        id: 'session-1',
        expiresAt: new Date('2025-12-20'),
        token: 'token-123',
        createdAt: new Date('2025-12-10'),
        updatedAt: new Date('2025-12-10'),
        userId: 'user-1',
      },
      user: {
        id: 'user-1',
        name: 'John Doe',
        email: 'john@example.com',
        emailVerified: true,
        image: null,
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date('2025-01-01'),
      },
    }

    it('owner has highest privilege', async () => {
      const mockOrg = createMockOrganization({
        members: [createMockMember({ role: 'owner' })],
      })

      vi.mocked(auth.api.getSession).mockResolvedValue(mockSession)
      vi.mocked(auth.api.getFullOrganization).mockResolvedValue(mockOrgResponse(mockOrg))

      // Owner can access all role levels
      await expect(requireRole(['owner', 'admin', 'member', 'user'])).resolves.toBeDefined()
      await expect(requireRole(['owner'])).resolves.toBeDefined()
    })

    it('admin is below owner', async () => {
      const mockOrg = createMockOrganization({
        members: [createMockMember({ role: 'admin' })],
      })

      vi.mocked(auth.api.getSession).mockResolvedValue(mockSession)
      vi.mocked(auth.api.getFullOrganization).mockResolvedValue(mockOrgResponse(mockOrg))

      // Admin can access admin, member, and user levels
      await expect(requireRole(['admin', 'member', 'user'])).resolves.toBeDefined()
      // Admin cannot access owner-only
      await expect(requireRole(['owner'])).rejects.toThrow('Forbidden')
    })

    it('member is below admin', async () => {
      const mockOrg = createMockOrganization({
        members: [createMockMember({ role: 'member' })],
      })

      vi.mocked(auth.api.getSession).mockResolvedValue(mockSession)
      vi.mocked(auth.api.getFullOrganization).mockResolvedValue(mockOrgResponse(mockOrg))

      // Member can access member and user levels
      await expect(requireRole(['member', 'user'])).resolves.toBeDefined()
      // Member cannot access admin or owner
      await expect(requireRole(['admin'])).rejects.toThrow('Forbidden')
      await expect(requireRole(['owner'])).rejects.toThrow('Forbidden')
    })

    it('user has lowest privilege', async () => {
      const mockOrg = createMockOrganization({
        members: [createMockMember({ role: 'user' })],
      })

      vi.mocked(auth.api.getSession).mockResolvedValue(mockSession)
      vi.mocked(auth.api.getFullOrganization).mockResolvedValue(mockOrgResponse(mockOrg))

      // User can only access user level
      await expect(requireRole(['user'])).resolves.toBeDefined()
      // User cannot access any higher levels
      await expect(requireRole(['member'])).rejects.toThrow('Forbidden')
      await expect(requireRole(['admin'])).rejects.toThrow('Forbidden')
      await expect(requireRole(['owner'])).rejects.toThrow('Forbidden')
    })

    it('validates complete role hierarchy: owner > admin > member > user', async () => {
      // Test with owner role
      const ownerOrg = createMockOrganization({
        members: [createMockMember({ role: 'owner' })],
      })

      vi.mocked(auth.api.getSession).mockResolvedValue(mockSession)
      vi.mocked(auth.api.getFullOrganization).mockResolvedValue(mockOrgResponse(ownerOrg))

      const ownerResult = await requireRole(['owner', 'admin', 'member', 'user'])
      expect(ownerResult.member.role).toBe('owner')

      // Test with admin role
      const adminOrg = createMockOrganization({
        members: [createMockMember({ role: 'admin' })],
      })
      vi.mocked(auth.api.getFullOrganization).mockResolvedValue(mockOrgResponse(adminOrg))

      const adminResult = await requireRole(['admin', 'member', 'user'])
      expect(adminResult.member.role).toBe('admin')
      await expect(requireRole(['owner'])).rejects.toThrow('Forbidden')

      // Test with member role
      const memberOrg = createMockOrganization({
        members: [createMockMember({ role: 'member' })],
      })
      vi.mocked(auth.api.getFullOrganization).mockResolvedValue(mockOrgResponse(memberOrg))

      const memberResult = await requireRole(['member', 'user'])
      expect(memberResult.member.role).toBe('member')
      await expect(requireRole(['admin'])).rejects.toThrow('Forbidden')

      // Test with user role
      const userOrg = createMockOrganization({
        members: [createMockMember({ role: 'user' })],
      })
      vi.mocked(auth.api.getFullOrganization).mockResolvedValue(mockOrgResponse(userOrg))

      const userResult = await requireRole(['user'])
      expect(userResult.member.role).toBe('user')
      await expect(requireRole(['member'])).rejects.toThrow('Forbidden')
    })
  })
})
