import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'

// Mock the tenant module to avoid path resolution issues
vi.mock('@/lib/tenant', () => ({
  validateApiTenantAccess: vi.fn(),
}))

// Mock next/server to avoid issues
vi.mock('next/server', () => ({
  NextRequest: vi.fn(),
  NextResponse: {
    json: vi.fn((data, init) => ({ data, status: init?.status || 200 })),
  },
}))

import {
  ApiError,
  verifyResourceOwnership,
  validateBody,
  hasMinimumRole,
  isAllowedRole,
  requireRole,
} from '../api-handler'

describe('ApiError', () => {
  it('sets message and status', () => {
    const error = new ApiError('Not found', 404)
    expect(error.message).toBe('Not found')
    expect(error.status).toBe(404)
  })

  it('extends Error class', () => {
    const error = new ApiError('Test', 500)
    expect(error).toBeInstanceOf(Error)
  })

  it('has name "ApiError"', () => {
    const error = new ApiError('Test', 500)
    expect(error.name).toBe('ApiError')
  })
})

describe('verifyResourceOwnership', () => {
  const orgId = 'org-123'

  it('throws 404 when resource is null', () => {
    expect(() => verifyResourceOwnership(null, orgId, 'Board')).toThrow(ApiError)
    try {
      verifyResourceOwnership(null, orgId, 'Board')
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError)
      expect((e as ApiError).status).toBe(404)
      expect((e as ApiError).message).toBe('Board not found')
    }
  })

  it('throws 404 when resource is undefined', () => {
    expect(() => verifyResourceOwnership(undefined, orgId, 'Post')).toThrow(ApiError)
    try {
      verifyResourceOwnership(undefined, orgId, 'Post')
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError)
      expect((e as ApiError).status).toBe(404)
      expect((e as ApiError).message).toBe('Post not found')
    }
  })

  it('throws 403 when organizationId does not match', () => {
    const resource = { organizationId: 'other-org' }
    expect(() => verifyResourceOwnership(resource, orgId, 'Status')).toThrow(ApiError)
    try {
      verifyResourceOwnership(resource, orgId, 'Status')
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError)
      expect((e as ApiError).status).toBe(403)
      expect((e as ApiError).message).toBe('Forbidden')
    }
  })

  it('does not throw when resource is valid and org matches', () => {
    const resource = { organizationId: orgId, name: 'Test Resource' }
    expect(() => verifyResourceOwnership(resource, orgId, 'Resource')).not.toThrow()
  })

  it('uses default resource name when not provided', () => {
    try {
      verifyResourceOwnership(null, orgId)
    } catch (e) {
      expect((e as ApiError).message).toBe('Resource not found')
    }
  })
})

describe('validateBody', () => {
  const schema = z.object({
    name: z.string().min(1, 'Name is required'),
    count: z.number().positive('Count must be positive'),
  })

  it('returns parsed data for valid input', () => {
    const body = { name: 'Test', count: 5 }
    const result = validateBody(schema, body)
    expect(result).toEqual({ name: 'Test', count: 5 })
  })

  it('throws ApiError with 400 for invalid input', () => {
    const body = { name: '', count: 5 }
    expect(() => validateBody(schema, body)).toThrow(ApiError)
    try {
      validateBody(schema, body)
    } catch (e) {
      expect((e as ApiError).status).toBe(400)
    }
  })

  it('uses first Zod issue message', () => {
    const body = { name: '', count: -1 }
    try {
      validateBody(schema, body)
    } catch (e) {
      // First error should be about name
      expect((e as ApiError).message).toBe('Name is required')
    }
  })

  it('handles missing required fields', () => {
    const body = {}
    expect(() => validateBody(schema, body)).toThrow(ApiError)
    try {
      validateBody(schema, body)
    } catch (e) {
      expect((e as ApiError).status).toBe(400)
    }
  })
})

describe('hasMinimumRole', () => {
  describe('owner role', () => {
    it('owner >= owner: true', () => {
      expect(hasMinimumRole('owner', 'owner')).toBe(true)
    })

    it('owner >= admin: true', () => {
      expect(hasMinimumRole('owner', 'admin')).toBe(true)
    })

    it('owner >= member: true', () => {
      expect(hasMinimumRole('owner', 'member')).toBe(true)
    })
  })

  describe('admin role', () => {
    it('admin >= owner: false', () => {
      expect(hasMinimumRole('admin', 'owner')).toBe(false)
    })

    it('admin >= admin: true', () => {
      expect(hasMinimumRole('admin', 'admin')).toBe(true)
    })

    it('admin >= member: true', () => {
      expect(hasMinimumRole('admin', 'member')).toBe(true)
    })
  })

  describe('member role', () => {
    it('member >= owner: false', () => {
      expect(hasMinimumRole('member', 'owner')).toBe(false)
    })

    it('member >= admin: false', () => {
      expect(hasMinimumRole('member', 'admin')).toBe(false)
    })

    it('member >= member: true', () => {
      expect(hasMinimumRole('member', 'member')).toBe(true)
    })
  })
})

describe('isAllowedRole', () => {
  it('returns true when role is in allowed list', () => {
    expect(isAllowedRole('admin', ['owner', 'admin'])).toBe(true)
  })

  it('returns false when role is not in allowed list', () => {
    expect(isAllowedRole('member', ['owner', 'admin'])).toBe(false)
  })

  it('works with single role in list', () => {
    expect(isAllowedRole('owner', ['owner'])).toBe(true)
    expect(isAllowedRole('admin', ['owner'])).toBe(false)
  })

  it('works with all roles in list', () => {
    expect(isAllowedRole('member', ['owner', 'admin', 'member'])).toBe(true)
  })
})

describe('requireRole', () => {
  it('delegates to isAllowedRole correctly', () => {
    // requireRole is a thin wrapper, should behave identically to isAllowedRole
    expect(requireRole('admin', ['owner', 'admin'])).toBe(true)
    expect(requireRole('member', ['owner', 'admin'])).toBe(false)
    expect(requireRole('owner', ['owner'])).toBe(true)
  })
})
