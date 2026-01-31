import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/api/auth'
import { noContentResponse, handleDomainError } from '@/lib/api/responses'
import { validateTypeId } from '@/lib/api/validation'
import type { RoadmapId, PostId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/roadmaps/$roadmapId/posts/$postId')({
  server: {
    handlers: {
      /**
       * DELETE /api/v1/roadmaps/:roadmapId/posts/:postId
       * Remove a post from a roadmap
       */
      DELETE: async ({ request, params }) => {
        // Authenticate
        const authResult = await withApiKeyAuth(request)
        if (authResult instanceof Response) return authResult

        try {
          const { roadmapId, postId } = params

          // Validate TypeID formats
          let validationError = validateTypeId(roadmapId, 'roadmap', 'roadmap ID')
          if (validationError) return validationError
          validationError = validateTypeId(postId, 'post', 'post ID')
          if (validationError) return validationError

          // Import service function
          const { removePostFromRoadmap } = await import('@/lib/roadmaps/roadmap.service')

          await removePostFromRoadmap(postId as PostId, roadmapId as RoadmapId)

          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
