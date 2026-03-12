import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import type { PostId } from '@quackback/ids'
import { getWidgetSession } from '@/lib/server/functions/widget-auth'
import { voteOnPost } from '@/lib/server/domains/posts/post.voting'
import { getWidgetBetterAuthFallback } from '@/lib/server/functions/widget-auth'
import { checkAnonVoteRateLimit } from '@/lib/server/utils/anon-rate-limit'

const voteSchema = z.object({
  postId: z.string().min(1),
})

function jsonError(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status })
}

export const Route = createFileRoute('/api/widget/vote')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: z.infer<typeof voteSchema>
        try {
          const raw = await request.json()
          body = voteSchema.parse(raw)
        } catch {
          return jsonError('VALIDATION_ERROR', 'postId is required', 400)
        }

        // Try widget identify() session first
        const auth = await getWidgetSession()
        if (auth) {
          try {
            const result = await voteOnPost(body.postId as PostId, auth.principal.id)
            return Response.json({ data: result })
          } catch (error) {
            console.error('[widget:vote] Error:', error)
            return jsonError('SERVER_ERROR', 'Failed to vote', 500)
          }
        }

        // Fall back to Better Auth session (covers anonymous users)
        const fallback = await getWidgetBetterAuthFallback(request)
        if (!fallback) {
          return jsonError('UNAUTHORIZED', 'Authentication required', 401)
        }

        try {
          // Rate limit anonymous voters
          if (fallback.type === 'anonymous') {
            const ip =
              request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
              request.headers.get('x-real-ip') ||
              '0.0.0.0'
            if (!(await checkAnonVoteRateLimit(ip))) {
              return jsonError('RATE_LIMITED', 'Too many votes, please try again later', 429)
            }
          }

          const result = await voteOnPost(body.postId as PostId, fallback.principalId)
          return Response.json({ data: result })
        } catch (error) {
          console.error('[widget:vote] Error:', error)
          return jsonError('SERVER_ERROR', 'Failed to vote', 500)
        }
      },
    },
  },
})
