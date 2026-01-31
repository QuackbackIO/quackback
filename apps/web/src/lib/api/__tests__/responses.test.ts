import { describe, it, expect } from 'vitest'

// Type for error response body
type ErrorBody = { error: { code: string; message: string; details?: unknown } }
import {
  successResponse,
  createdResponse,
  noContentResponse,
  errorResponse,
  badRequestResponse,
  unauthorizedResponse,
  forbiddenResponse,
  notFoundResponse,
  conflictResponse,
  validationErrorResponse,
  internalErrorResponse,
  handleDomainError,
  parsePaginationParams,
} from '../responses'

describe('API Responses', () => {
  describe('successResponse', () => {
    it('should return 200 status with data wrapper', async () => {
      const response = successResponse({ id: 'test', name: 'Test' })
      expect(response.status).toBe(200)

      const body = (await response.json()) as ErrorBody
      expect(body).toEqual({ data: { id: 'test', name: 'Test' } })
    })

    it('should support custom status code', async () => {
      const response = successResponse({ id: 'test' }, { status: 202 })
      expect(response.status).toBe(202)
    })

    it('should include pagination metadata when provided', async () => {
      const response = successResponse([{ id: '1' }, { id: '2' }], {
        pagination: {
          cursor: 'next-cursor',
          hasMore: true,
          total: 100,
        },
      })

      const body = (await response.json()) as ErrorBody
      expect(body).toEqual({
        data: [{ id: '1' }, { id: '2' }],
        meta: {
          pagination: {
            cursor: 'next-cursor',
            hasMore: true,
            total: 100,
          },
        },
      })
    })

    it('should handle empty data', async () => {
      const response = successResponse([])
      const body = (await response.json()) as ErrorBody
      expect(body).toEqual({ data: [] })
    })

    it('should handle null data', async () => {
      const response = successResponse(null)
      const body = (await response.json()) as ErrorBody
      expect(body).toEqual({ data: null })
    })
  })

  describe('createdResponse', () => {
    it('should return 201 status', async () => {
      const response = createdResponse({ id: 'new-id' })
      expect(response.status).toBe(201)

      const body = (await response.json()) as ErrorBody
      expect(body).toEqual({ data: { id: 'new-id' } })
    })
  })

  describe('noContentResponse', () => {
    it('should return 204 status with no body', () => {
      const response = noContentResponse()
      expect(response.status).toBe(204)
      expect(response.body).toBeNull()
    })
  })

  describe('errorResponse', () => {
    it('should return error structure with code and message', async () => {
      const response = errorResponse('TEST_ERROR', 'Test error message', 400)
      expect(response.status).toBe(400)

      const body = (await response.json()) as ErrorBody
      expect(body).toEqual({
        error: {
          code: 'TEST_ERROR',
          message: 'Test error message',
        },
      })
    })

    it('should include details when provided', async () => {
      const response = errorResponse('VALIDATION_ERROR', 'Invalid input', 400, {
        field: 'email',
        reason: 'must be valid email',
      })

      const body = (await response.json()) as ErrorBody
      expect(body.error.details).toEqual({
        field: 'email',
        reason: 'must be valid email',
      })
    })
  })

  describe('badRequestResponse', () => {
    it('should return 400 with BAD_REQUEST code', async () => {
      const response = badRequestResponse('Invalid request')
      expect(response.status).toBe(400)

      const body = (await response.json()) as ErrorBody
      expect(body.error.code).toBe('BAD_REQUEST')
      expect(body.error.message).toBe('Invalid request')
    })
  })

  describe('unauthorizedResponse', () => {
    it('should return 401 with default message', async () => {
      const response = unauthorizedResponse()
      expect(response.status).toBe(401)

      const body = (await response.json()) as ErrorBody
      expect(body.error.code).toBe('UNAUTHORIZED')
      expect(body.error.message).toBe('Authentication required')
    })

    it('should accept custom message', async () => {
      const response = unauthorizedResponse('Token expired')
      const body = (await response.json()) as ErrorBody
      expect(body.error.message).toBe('Token expired')
    })
  })

  describe('forbiddenResponse', () => {
    it('should return 403 with FORBIDDEN code', async () => {
      const response = forbiddenResponse('Not allowed')
      expect(response.status).toBe(403)

      const body = (await response.json()) as ErrorBody
      expect(body.error.code).toBe('FORBIDDEN')
    })
  })

  describe('notFoundResponse', () => {
    it('should return 404 with NOT_FOUND code', async () => {
      const response = notFoundResponse('User')
      expect(response.status).toBe(404)

      const body = (await response.json()) as ErrorBody
      expect(body.error.code).toBe('NOT_FOUND')
      expect(body.error.message).toBe('User not found')
    })
  })

  describe('conflictResponse', () => {
    it('should return 409 with CONFLICT code', async () => {
      const response = conflictResponse('Resource already exists')
      expect(response.status).toBe(409)

      const body = (await response.json()) as ErrorBody
      expect(body.error.code).toBe('CONFLICT')
    })
  })

  describe('validationErrorResponse', () => {
    it('should return 400 with VALIDATION_ERROR code', async () => {
      const response = validationErrorResponse('Name is required')
      expect(response.status).toBe(400)

      const body = (await response.json()) as ErrorBody
      expect(body.error.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('internalErrorResponse', () => {
    it('should return 500 with INTERNAL_ERROR code', async () => {
      const response = internalErrorResponse()
      expect(response.status).toBe(500)

      const body = (await response.json()) as ErrorBody
      expect(body.error.code).toBe('INTERNAL_ERROR')
    })
  })

  describe('handleDomainError', () => {
    it('should handle NOT_FOUND errors', async () => {
      const error = { code: 'NOT_FOUND', message: 'Post not found' }
      const response = handleDomainError(error)

      expect(response.status).toBe(404)
    })

    it('should handle POST_NOT_FOUND errors', async () => {
      const error = { code: 'POST_NOT_FOUND', message: 'Post not found' }
      const response = handleDomainError(error)

      expect(response.status).toBe(404)
    })

    it('should handle VALIDATION_ERROR', async () => {
      const error = { code: 'VALIDATION_ERROR', message: 'Name is required' }
      const response = handleDomainError(error)

      expect(response.status).toBe(400)
      const body = (await response.json()) as ErrorBody
      expect(body.error.code).toBe('VALIDATION_ERROR')
    })

    it('should handle DUPLICATE_SLUG as conflict', async () => {
      const error = { code: 'DUPLICATE_SLUG', message: 'Slug already exists' }
      const response = handleDomainError(error)

      expect(response.status).toBe(409)
    })

    it('should handle FORBIDDEN errors', async () => {
      const error = { code: 'FORBIDDEN', message: 'Access denied' }
      const response = handleDomainError(error)

      expect(response.status).toBe(403)
    })

    it('should return 500 for unknown errors', async () => {
      const error = { code: 'UNKNOWN_ERROR', message: 'Something went wrong' }
      const response = handleDomainError(error)

      expect(response.status).toBe(500)
    })

    it('should return 500 for non-object errors', async () => {
      const response = handleDomainError('string error')
      expect(response.status).toBe(500)
    })

    it('should return 500 for null errors', async () => {
      const response = handleDomainError(null)
      expect(response.status).toBe(500)
    })
  })

  describe('parsePaginationParams', () => {
    it('should parse cursor and limit from URL', () => {
      const url = new URL('https://example.com/api?cursor=abc123&limit=50')
      const result = parsePaginationParams(url)

      expect(result).toEqual({
        cursor: 'abc123',
        limit: 50,
      })
    })

    it('should use default limit when not provided', () => {
      const url = new URL('https://example.com/api')
      const result = parsePaginationParams(url)

      expect(result.limit).toBe(20)
      expect(result.cursor).toBeUndefined()
    })

    it('should cap limit at 100', () => {
      const url = new URL('https://example.com/api?limit=500')
      const result = parsePaginationParams(url)

      expect(result.limit).toBe(100)
    })

    it('should use default for limit=0', () => {
      // limit=0 is falsy, so it falls through to the default of 20
      const url = new URL('https://example.com/api?limit=0')
      const result = parsePaginationParams(url)

      expect(result.limit).toBe(20)
    })

    it('should enforce minimum limit of 1', () => {
      // Negative numbers are capped to 1 by Math.max
      const url = new URL('https://example.com/api?limit=-5')
      const result = parsePaginationParams(url)

      expect(result.limit).toBe(1)
    })

    it('should handle invalid limit gracefully', () => {
      const url = new URL('https://example.com/api?limit=invalid')
      const result = parsePaginationParams(url)

      expect(result.limit).toBe(20)
    })
  })
})
