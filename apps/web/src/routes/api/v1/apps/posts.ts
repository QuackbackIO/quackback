import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { badRequestResponse, handleDomainError } from '@/lib/server/domains/api/responses'
import { validateTypeId } from '@/lib/server/domains/api/validation'
import type { BoardId, PostId } from '@quackback/ids'
import { appJsonResponse, preflightResponse } from '@/lib/server/integrations/apps/cors'

const createPostSchema = z.object({
  boardId: z.string().min(1, 'Board ID is required'),
  title: z.string().min(1, 'Title is required').max(200),
  content: z.string().max(10000).optional().default(''),
  // Optional: link to ticket after creation
  link: z
    .object({
      integrationType: z.string().min(1),
      externalId: z.string().min(1),
      externalUrl: z.string().optional(),
    })
    .optional(),
  // Optional: requester whose vote is added
  requester: z
    .object({
      email: z.string().email(),
      name: z.string().optional(),
    })
    .optional(),
})

export const Route = createFileRoute('/api/v1/apps/posts')({
  server: {
    handlers: {
      OPTIONS: () => preflightResponse(),

      POST: async ({ request }) => {
        const authResult = await withApiKeyAuth(request, { role: 'team' })
        if (authResult instanceof Response) return authResult
        const { principalId } = authResult

        try {
          const body = await request.json()
          const parsed = createPostSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const validationError = validateTypeId(parsed.data.boardId, 'board', 'board ID')
          if (validationError) return validationError

          // Resolve author: use requester if provided, else the API key principal
          let authorPrincipalId = principalId
          if (parsed.data.requester?.email) {
            const { identifyPortalUser } = await import('@/lib/server/domains/users/user.service')
            const identified = await identifyPortalUser({
              email: parsed.data.requester.email,
              name: parsed.data.requester.name,
            })
            authorPrincipalId = identified.principalId
          }

          const { createPost } = await import('@/lib/server/domains/posts/post.service')
          const { db, principal, eq } = await import('@/lib/server/db')

          const principalRecord = await db.query.principal.findFirst({
            where: eq(principal.id, authorPrincipalId),
            columns: { id: true, displayName: true },
            with: { user: { columns: { id: true, name: true, email: true } } },
          })

          const result = await createPost(
            {
              boardId: parsed.data.boardId as BoardId,
              title: parsed.data.title,
              content: parsed.data.content,
            },
            {
              principalId: authorPrincipalId,
              userId: principalRecord?.user?.id,
              displayName: principalRecord?.displayName ?? undefined,
              name: principalRecord?.user?.name,
              email: principalRecord?.user?.email,
            }
          )

          // If link info provided, link ticket to the newly created post
          if (parsed.data.link) {
            const { linkTicketToPost } = await import('@/lib/server/integrations/apps/service')
            await linkTicketToPost(
              {
                postId: result.id as PostId,
                integrationType: parsed.data.link.integrationType,
                externalId: parsed.data.link.externalId,
                externalUrl: parsed.data.link.externalUrl,
                requester: parsed.data.requester,
              },
              principalId
            )
          }

          return appJsonResponse(
            {
              id: result.id,
              title: result.title,
              content: result.content,
              voteCount: result.voteCount,
              boardId: result.boardId,
              statusId: result.statusId,
              createdAt: result.createdAt.toISOString(),
            },
            201
          )
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
