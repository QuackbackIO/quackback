/**
 * Standard API Response Helpers
 *
 * Provides consistent response formatting for the public REST API.
 * All responses include security headers (X-Content-Type-Options, Cache-Control).
 */

/** Security headers applied to all API responses. */
const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-store, private',
}

/** Create a JSON Response with security headers. */
function jsonResponse(
  body: unknown,
  init?: { status?: number; headers?: Record<string, string> }
): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      'Content-Type': 'application/json',
      ...SECURITY_HEADERS,
      ...init?.headers,
    },
  })
}

export interface PaginationMeta {
  cursor: string | null
  hasMore: boolean
  total?: number
}

export interface ApiSuccessResponse<T> {
  data: T
  meta?: {
    pagination?: PaginationMeta
  }
}

export interface ApiErrorResponse {
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

/**
 * Create a successful JSON response
 */
export function successResponse<T>(
  data: T,
  options?: {
    status?: number
    pagination?: PaginationMeta
  }
): Response {
  const body: ApiSuccessResponse<T> = { data }

  if (options?.pagination) {
    body.meta = { pagination: options.pagination }
  }

  return jsonResponse(body, { status: options?.status ?? 200 })
}

/**
 * Create a successful response for created resources
 */
export function createdResponse<T>(data: T): Response {
  return successResponse(data, { status: 201 })
}

/**
 * Create a successful response with no content
 */
export function noContentResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: SECURITY_HEADERS,
  })
}

/**
 * Create an error JSON response
 */
export function errorResponse(
  code: string,
  message: string,
  status: number,
  details?: Record<string, unknown>
): Response {
  const body: ApiErrorResponse = {
    error: {
      code,
      message,
      ...(details && { details }),
    },
  }

  return jsonResponse(body, { status })
}

// Common error responses

export function badRequestResponse(message: string, details?: Record<string, unknown>): Response {
  return errorResponse('BAD_REQUEST', message, 400, details)
}

export function unauthorizedResponse(message = 'Authentication required'): Response {
  return errorResponse('UNAUTHORIZED', message, 401)
}

export function forbiddenResponse(message = 'Access denied'): Response {
  return errorResponse('FORBIDDEN', message, 403)
}

export function notFoundResponse(resource: string): Response {
  return errorResponse('NOT_FOUND', `${resource} not found`, 404)
}

export function conflictResponse(message: string): Response {
  return errorResponse('CONFLICT', message, 409)
}

export function validationErrorResponse(
  message: string,
  details?: Record<string, unknown>
): Response {
  return errorResponse('VALIDATION_ERROR', message, 400, details)
}

export function internalErrorResponse(message = 'Internal server error'): Response {
  return errorResponse('INTERNAL_ERROR', message, 500)
}

export function rateLimitedResponse(retryAfter: number): Response {
  return jsonResponse(
    { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' } },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } }
  )
}

// Map error codes to resource names for not found responses
const NOT_FOUND_RESOURCES: Record<string, string> = {
  NOT_FOUND: 'Resource',
  BOARD_NOT_FOUND: 'Board',
  POST_NOT_FOUND: 'Post',
  COMMENT_NOT_FOUND: 'Comment',
  TAG_NOT_FOUND: 'Tag',
  STATUS_NOT_FOUND: 'Status',
  MEMBER_NOT_FOUND: 'Member',
  ROADMAP_NOT_FOUND: 'Roadmap',
  CHANGELOG_NOT_FOUND: 'Changelog entry',
  API_KEY_NOT_FOUND: 'API key',
}

/**
 * Handle domain errors and convert to appropriate API responses
 */
export function handleDomainError(error: unknown): Response {
  // Check for known error types
  if (error && typeof error === 'object' && 'code' in error) {
    const domainError = error as { code: string; message: string; statusCode?: number }

    // Check if it's a not found error
    const resourceName = NOT_FOUND_RESOURCES[domainError.code]
    if (resourceName) {
      return notFoundResponse(resourceName)
    }

    switch (domainError.code) {
      case 'VALIDATION_ERROR':
        return validationErrorResponse(domainError.message)

      case 'DUPLICATE_SLUG':
      case 'CONFLICT':
        return conflictResponse(domainError.message)

      case 'FORBIDDEN':
      case 'UNAUTHORIZED':
        return forbiddenResponse(domainError.message)

      default:
        console.error('[api] Unhandled domain error:', error)
        return internalErrorResponse()
    }
  }

  // Log unexpected errors
  console.error('[api] Unexpected error:', error)
  return internalErrorResponse()
}

/**
 * Parse pagination parameters from URL search params
 */
export function parsePaginationParams(url: URL): {
  cursor?: string
  limit: number
} {
  const cursor = url.searchParams.get('cursor') ?? undefined
  const limitParam = url.searchParams.get('limit')
  const limit = Math.min(Math.max(parseInt(limitParam || '20', 10) || 20, 1), 100)

  return { cursor, limit }
}

/**
 * Cursor-Based Pagination
 *
 * Note: This implementation uses offset-based pagination internally, wrapped in
 * opaque cursors. While this provides a stable API, it has known limitations:
 *
 * - Offset pagination can be slow for large datasets (>100K rows)
 * - Items may be skipped/duplicated if data changes between requests
 *
 * For production scale, consider migrating to keyset pagination using a
 * (createdAt, id) tuple. This would require service layer changes but
 * maintains the same cursor API contract.
 */

/**
 * Encode a cursor from offset value
 * Uses base64 encoding of JSON for flexibility
 */
export function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset })).toString('base64url')
}

/**
 * Decode a cursor to get offset value
 * Returns 0 if cursor is invalid or not provided
 */
export function decodeCursor(cursor?: string): number {
  if (!cursor) return 0
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'))
    return typeof decoded.offset === 'number' && decoded.offset >= 0 ? decoded.offset : 0
  } catch {
    return 0
  }
}
