/**
 * OpenAPI Specification Generator
 *
 * Uses zod-openapi to generate OpenAPI 3.1 spec from Zod schemas.
 * This package uses Zod v4's native .meta() method for OpenAPI metadata.
 */

import 'zod-openapi' // TypeScript type augmentation for .meta()
import { createDocument, type ZodOpenApiPathsObject } from 'zod-openapi'
import { z } from 'zod'

// Re-export z for use in schema files
export { z }

// Store registered paths for the document
const registeredPaths: ZodOpenApiPathsObject = {}

/**
 * Register an API path
 */
export function registerPath(path: string, methods: ZodOpenApiPathsObject[string]) {
  registeredPaths[path] = { ...registeredPaths[path], ...methods }
}

/**
 * Common schema components
 */

// TypeID pattern (e.g., post_01h455vb4pex5vsknk084sn02q)
export const TypeIdSchema = z.string().meta({
  description: 'TypeID - a type-prefixed UUID',
  example: 'post_01h455vb4pex5vsknk084sn02q',
})

// Pagination parameters
export const PaginationParamsSchema = z.object({
  cursor: z.string().optional().meta({
    description: 'Cursor for pagination',
  }),
  limit: z.coerce.number().min(1).max(100).default(20).meta({
    description: 'Number of items per page (1-100)',
    example: 20,
  }),
})

// Pagination metadata in response
export const PaginationMetaSchema = z.object({
  cursor: z.string().nullable().optional().meta({
    description: 'Cursor for next page, null if no more pages',
  }),
  hasMore: z.boolean().meta({
    description: 'Whether there are more items',
  }),
  total: z.number().optional().meta({
    description: 'Total count (when available)',
  }),
})

// Standard error response
export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string().meta({
      description: 'Error code',
      example: 'NOT_FOUND',
    }),
    message: z.string().meta({
      description: 'Human-readable error message',
      example: 'Resource not found',
    }),
    details: z.record(z.string(), z.unknown()).optional().meta({
      description: 'Additional error details',
    }),
  }),
})

/**
 * Generate the complete OpenAPI specification
 */
export function generateOpenAPISpec(): ReturnType<typeof createDocument> {
  return createDocument({
    openapi: '3.1.0',
    info: {
      title: 'Quackback API',
      version: '1.0.0',
      description: `
Quackback Public REST API for managing feedback, posts, boards, and more.

## Authentication

All API endpoints require authentication using an API key. Include your API key in the Authorization header:

\`\`\`
Authorization: Bearer qb_your_api_key_here
\`\`\`

API keys can be created in the Quackback admin dashboard under Settings > API Keys.

## Rate Limiting

API requests are not currently rate limited, but this may change in the future.

## Pagination

List endpoints support cursor-based pagination:
- Use the \`limit\` parameter to control page size (1-100, default 20)
- Use the \`cursor\` parameter with the value from \`meta.pagination.cursor\` to fetch the next page
- When \`meta.pagination.hasMore\` is false, there are no more items

## TypeIDs

All resource IDs use TypeID format: \`{type}_{base32_uuid}\`
Example: \`post_01h455vb4pex5vsknk084sn02q\`
`.trim(),
      contact: {
        name: 'Quackback Support',
        url: 'https://github.com/quackback/quackback',
      },
      license: {
        name: 'AGPL-3.0',
        url: 'https://www.gnu.org/licenses/agpl-3.0.html',
      },
    },
    servers: [
      {
        url: '/api/v1',
        description: 'API v1',
      },
    ],
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Posts', description: 'Manage feedback posts' },
      { name: 'Boards', description: 'Manage feedback boards' },
      { name: 'Comments', description: 'Manage post comments' },
      { name: 'Votes', description: 'Manage post votes' },
      { name: 'Tags', description: 'Manage tags' },
      { name: 'Statuses', description: 'Manage post statuses' },
      { name: 'Members', description: 'Manage workspace members' },
      { name: 'Roadmaps', description: 'Manage roadmaps' },
      { name: 'Changelog', description: 'Manage changelog entries' },
    ],
    paths: registeredPaths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'API Key',
          description: 'API key authentication. Format: Bearer qb_xxx',
        },
      },
    },
  })
}

/**
 * Helper to create a paginated response schema
 */
export function createPaginatedResponseSchema<T extends z.ZodTypeAny>(
  itemSchema: T,
  description: string
) {
  return z
    .object({
      data: z.array(itemSchema),
      meta: z
        .object({
          pagination: PaginationMetaSchema,
        })
        .optional(),
    })
    .meta({ description })
}

/**
 * Helper to create a single item response schema
 */
export function createItemResponseSchema<T extends z.ZodTypeAny>(
  itemSchema: T,
  description: string
) {
  return z
    .object({
      data: itemSchema,
    })
    .meta({ description })
}

/**
 * Helper to create a request body schema with proper typing for zod-openapi
 */
export function createRequestBodySchema<T extends z.ZodRawShape>(shape: T, description?: string) {
  const schema = z.object(shape)
  return description ? schema.meta({ description }) : schema.meta({})
}

/**
 * Type helper to ensure Zod schemas are compatible with zod-openapi's expected types.
 * This works around a type inference issue between Zod v4 and zod-openapi v5
 * where different package versions cause nominal type mismatches.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function asSchema<T extends z.ZodTypeAny>(schema: T): any {
  return schema
}
