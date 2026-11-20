import { createFileRoute } from '@tanstack/react-router'
import type { UserId } from '@quackback/ids'
import { auth } from '@/lib/server/auth'
import { db, eq, principal } from '@/lib/server/db'
import {
  ANONYMOUS_UPLOAD_REFUSED,
  mayUploadPostMedia,
} from '@/lib/server/storage/anonymous-upload-gate'
import { isS3Configured, uploadMediaFromFormData } from '@/lib/server/storage/s3'
import { incrementBucket, bucketRetryAfter } from '@/lib/server/utils/rate-bucket'
import { isBlockedCustomer } from '@/lib/server/domains/principals/blocking'
import { PERSON_BLOCKED_CODE, PERSON_BLOCKED_MESSAGE } from '@/lib/shared/person-blocked'

export async function handlePortalUpload({ request }: { request: Request }): Promise<Response> {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const principalRecord = await db.query.principal.findFirst({
    where: eq(principal.userId, session.user.id as UserId),
    columns: { id: true, type: true, role: true, blockedAt: true },
  })
  if (!principalRecord) return Response.json({ error: 'Forbidden' }, { status: 403 })
  // Media here goes into posts and comments, which a blocked person cannot
  // write (blocking.ts). Support attachments use /api/portal/files instead.
  if (isBlockedCustomer(principalRecord)) {
    return Response.json(
      { error: PERSON_BLOCKED_MESSAGE, code: PERSON_BLOCKED_CODE },
      { status: 403 }
    )
  }
  // An anonymous session uploads only while anonymous posting is on.
  if (!(await mayUploadPostMedia(principalRecord))) {
    return Response.json(ANONYMOUS_UPLOAD_REFUSED, { status: 403 })
  }
  const bucket = { key: `portal-upload:user:${session.user.id}`, windowSeconds: 60 }
  const { count } = await incrementBucket(bucket)
  if (count !== null && count > 20) {
    const retryAfter = await bucketRetryAfter(bucket)
    return Response.json(
      { error: 'Too many uploads, slow down' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    )
  }
  if (!isS3Configured()) {
    return Response.json({ error: 'Storage not configured' }, { status: 503 })
  }
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }
  return uploadMediaFromFormData(formData, 'portal-media')
}

export const Route = createFileRoute('/api/portal/upload')({
  server: {
    handlers: {
      POST: handlePortalUpload,
    },
  },
})
