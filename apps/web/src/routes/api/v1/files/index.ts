import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  createdResponse,
  errorResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { FileRejection } from '@/lib/server/domains/files/files.service'

/** A rejection reason from files.upload.ts, mapped to its v1 error code. */
const REJECTION_CODE: Record<FileRejection, string> = {
  empty: 'VALIDATION_ERROR',
  too_large: 'PAYLOAD_TOO_LARGE',
  blocked: 'UNSUPPORTED_MEDIA_TYPE',
}

export const Route = createFileRoute('/api/v1/files/')({
  server: {
    handlers: {
      /**
       * POST /api/v1/files?name=<file name>
       *
       * Upload a file (the raw body, not multipart) so it can be attached by
       * `fileId` to a conversation reply/note or a ticket. Gated by the same
       * `conversation.reply` write authority those routes require — there is
       * no attachment-specific scope, and uploading is only ever a step
       * toward attaching. Mirrors the agent/widget/portal upload routes
       * (`handleFileUploadRequest`) but answers in the v1 envelope.
       */
      POST: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, {
            permission: PERMISSIONS.CONVERSATION_REPLY,
          })

          const { handleFileUploadRequest } =
            await import('@/lib/server/domains/files/files.upload')
          const uploadResponse = await handleFileUploadRequest(request, {
            source: 'api',
            uploadedById: auth.principalId,
            unverifiedSender: false,
          })

          const body = (await uploadResponse.json().catch(() => null)) as
            | {
                fileId: string
                url: string
                name: string
                contentType: string
                size: number
                family: string
              }
            | { error: string; reason?: FileRejection }
            | null

          if (uploadResponse.status === 201) {
            return createdResponse(body)
          }

          const message =
            body && typeof body === 'object' && 'error' in body ? body.error : 'Upload failed'
          const reason =
            body && typeof body === 'object' && 'reason' in body ? body.reason : undefined
          const code = reason
            ? REJECTION_CODE[reason]
            : uploadResponse.status === 503
              ? 'SERVICE_UNAVAILABLE'
              : 'BAD_REQUEST'
          return errorResponse(code, message, uploadResponse.status)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
