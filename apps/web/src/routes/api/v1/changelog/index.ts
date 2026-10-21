import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  createdResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { createChangelog } from '@/lib/server/domains/changelog/changelog.service'
import { listChangelogs } from '@/lib/server/domains/changelog/changelog.query'
import { publishedAtToPublishState } from '@/lib/shared/schemas/changelog'
import { parseTypeIdArray } from '@/lib/server/domains/api/validation'
import { db, principal, eq } from '@/lib/server/db'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { isValidTypeId } from '@quackback/ids'
import type { PostId, ChangelogCategoryId } from '@quackback/ids'
import { formatChangelogResponse } from './-serialize'

// Input validation schema
const createChangelogSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  content: z.string().min(1, 'Content is required'),
  publishedAt: z.string().datetime().optional(),
  linkedPostIds: z.array(z.string()).optional(),
})

/**
 * Split a comma-separated query param into trimmed, non-empty values.
 * Returns undefined when the param is absent OR contains nothing usable, so
 * `?labels=` and `?labels=,,` both read as "no filter" rather than "match
 * the empty label".
 */
function parseCsvParam(raw: string | null): string[] | undefined {
  if (raw === null) return undefined
  const values = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  return values.length > 0 ? values : undefined
}

export const Route = createFileRoute('/api/v1/changelog/')({
  server: {
    handlers: {
      /**
       * GET /api/v1/changelog
       * List all changelog entries
       */
      GET: async ({ request }) => {
        try {
          await withApiKeyAuth(request, { permission: PERMISSIONS.CHANGELOG_VIEW_DRAFT })

          // Parse query params
          const url = new URL(request.url)
          const published = url.searchParams.get('published')
          const cursor = url.searchParams.get('cursor') ?? undefined
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100)

          // Map published filter to service status param
          let status: 'draft' | 'published' | 'all' = 'all'
          if (published === 'true') {
            status = 'published'
          } else if (published === 'false') {
            status = 'draft'
          }

          // Label filters: `labels` (comma-separated names, case-insensitive)
          // and `labelIds` (comma-separated typeids; malformed ones are
          // dropped rather than 400-ing, mirroring /api/v1/posts' tagIds).
          const categories = parseCsvParam(url.searchParams.get('labels'))
          const categoryIds = parseCsvParam(url.searchParams.get('labelIds'))?.filter((id) =>
            isValidTypeId(id, 'changelog_category')
          ) as ChangelogCategoryId[] | undefined

          const result = await listChangelogs({ status, categories, categoryIds, cursor, limit })

          return successResponse(
            result.items.map((entry) => formatChangelogResponse(entry)),
            {
              pagination: {
                cursor: result.nextCursor,
                hasMore: result.hasMore,
              },
            }
          )
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * POST /api/v1/changelog
       * Create a new changelog entry
       */
      POST: async ({ request }) => {
        try {
          const authResult = await withApiKeyAuth(request, {
            permission: PERMISSIONS.CHANGELOG_MANAGE,
          })
          // Parse and validate body
          const body = await request.json()
          const parsed = createChangelogSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          // Determine publish state from publishedAt
          const publishState = publishedAtToPublishState(parsed.data.publishedAt)

          // Look up principal display name for author info
          const principalRecord = await db.query.principal.findFirst({
            where: eq(principal.id, authResult.principalId),
            columns: { displayName: true },
          })
          const authorName = principalRecord?.displayName ?? 'API'

          const entry = await createChangelog(
            {
              title: parsed.data.title,
              content: parsed.data.content,
              publishState,
              linkedPostIds: parseTypeIdArray<PostId>(
                parsed.data.linkedPostIds,
                'post',
                'linked post IDs'
              ),
            },
            {
              principalId: authResult.principalId,
              name: authorName,
            }
          )

          return createdResponse(formatChangelogResponse(entry))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
