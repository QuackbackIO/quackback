import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  noContentResponse,
  notFoundResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { validateTypeId } from '@/lib/server/domains/api/validation'
import type { PrincipalId } from '@quackback/ids'

const updateUserSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  image: z.string().url().nullable().optional(),
  emailVerified: z.boolean().optional(),
  externalId: z.string().max(255).nullable().optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
})

export const Route = createFileRoute('/api/v1/users/$principalId')({
  server: {
    handlers: {
      /**
       * GET /api/v1/users/:principalId
       * Get a single portal user by principal ID
       */
      GET: async ({ request, params }) => {
        // Authenticate
        const authResult = await withApiKeyAuth(request, { role: 'team' })
        if (authResult instanceof Response) return authResult

        try {
          const { principalId } = params

          // Validate TypeID format
          const validationError = validateTypeId(principalId, 'principal', 'principal ID')
          if (validationError) return validationError

          // Import service function
          const { getPortalUserDetail, parseUserAttributes } =
            await import('@/lib/server/domains/users/user.service')

          const user = await getPortalUserDetail(principalId as PrincipalId)

          if (!user) {
            return notFoundResponse('Portal user not found')
          }

          return successResponse({
            principalId: user.principalId,
            userId: user.userId,
            name: user.name,
            email: user.email,
            image: user.image,
            emailVerified: user.emailVerified,
            attributes: parseUserAttributes(user.metadata),
            joinedAt: user.joinedAt.toISOString(),
            createdAt: user.createdAt.toISOString(),
            postCount: user.postCount,
            commentCount: user.commentCount,
            voteCount: user.voteCount,
            engagedPosts: user.engagedPosts.map((post) => ({
              id: post.id,
              title: post.title,
              content: post.content,
              statusId: post.statusId,
              statusName: post.statusName,
              statusColor: post.statusColor,
              voteCount: post.voteCount,
              commentCount: post.commentCount,
              boardSlug: post.boardSlug,
              boardName: post.boardName,
              authorName: post.authorName,
              createdAt: post.createdAt.toISOString(),
              engagementTypes: post.engagementTypes,
              engagedAt: post.engagedAt.toISOString(),
            })),
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * PATCH /api/v1/users/:principalId
       * Update a portal user's profile and attributes.
       * User attributes must be configured in Settings before they can be set.
       */
      PATCH: async ({ request, params }) => {
        // Authenticate
        const authResult = await withApiKeyAuth(request, { role: 'team' })
        if (authResult instanceof Response) return authResult

        try {
          const { principalId } = params

          // Validate TypeID format
          const validationError = validateTypeId(principalId, 'principal', 'principal ID')
          if (validationError) return validationError

          // Parse and validate body
          const body = await request.json()
          const parsed = updateUserSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          // Import service function
          const { updatePortalUser } = await import('@/lib/server/domains/users/user.service')

          const result = await updatePortalUser(principalId as PrincipalId, parsed.data)

          return successResponse({
            principalId: result.principalId,
            userId: result.userId,
            name: result.name,
            email: result.email,
            image: result.image,
            emailVerified: result.emailVerified,
            externalId: result.externalId,
            attributes: result.attributes,
            createdAt: result.createdAt.toISOString(),
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * DELETE /api/v1/users/:principalId
       * Remove a portal user
       */
      DELETE: async ({ request, params }) => {
        // Authenticate (admin only)
        const authResult = await withApiKeyAuth(request, { role: 'admin' })
        if (authResult instanceof Response) return authResult

        try {
          const { principalId } = params

          // Validate TypeID format
          const validationError = validateTypeId(principalId, 'principal', 'principal ID')
          if (validationError) return validationError

          // Import service function
          const { removePortalUser } = await import('@/lib/server/domains/users/user.service')

          await removePortalUser(principalId as PrincipalId)

          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
