/**
 * Common API Schemas
 *
 * Shared Zod schemas with OpenAPI extensions for the public API.
 * Uses .meta() method for OpenAPI metadata (provided by zod-openapi).
 */

import 'zod-openapi' // TypeScript type augmentation for .meta()
import { z } from 'zod'

// Timestamp schema
export const TimestampSchema = z.string().datetime().meta({
  description: 'ISO 8601 timestamp',
  example: '2024-01-15T10:30:00.000Z',
})

// Nullable timestamp
export const NullableTimestampSchema = z.string().datetime().nullable().meta({
  description: 'ISO 8601 timestamp or null',
  example: '2024-01-15T10:30:00.000Z',
})

// Hex color schema
export const HexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .meta({
    description: 'Hex color code',
    example: '#3b82f6',
  })

// Slug schema
export const SlugSchema = z.string().min(1).max(100).meta({
  description: 'URL-friendly identifier',
  example: 'feature-requests',
})

// Pagination meta schema
export const PaginationMetaSchema = z
  .object({
    cursor: z.string().nullable().meta({
      description: 'Cursor for fetching next page (null if no more pages)',
    }),
    hasMore: z.boolean().meta({
      description: 'Whether there are more items to fetch',
    }),
  })
  .meta({
    description: 'Cursor-based pagination metadata',
  })

// Common error response schemas
export const UnauthorizedErrorSchema = z
  .object({
    error: z.object({
      code: z.literal('UNAUTHORIZED'),
      message: z.string(),
    }),
  })
  .meta({
    description: 'Authentication required or invalid API key',
  })

export const NotFoundErrorSchema = z
  .object({
    error: z.object({
      code: z.literal('NOT_FOUND'),
      message: z.string(),
    }),
  })
  .meta({
    description: 'Resource not found',
  })

export const ValidationErrorSchema = z
  .object({
    error: z.object({
      code: z.literal('VALIDATION_ERROR'),
      message: z.string(),
      details: z.record(z.string(), z.unknown()).optional(),
    }),
  })
  .meta({
    description: 'Request validation failed',
  })
