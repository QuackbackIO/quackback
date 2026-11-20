import { createFileRoute } from '@tanstack/react-router'
import type { UserId } from '@quackback/ids'
import { auth } from '@/lib/server/auth'
import { db, eq, principal } from '@/lib/server/db'
import { getPortalConfig } from '@/lib/server/domains/settings/settings.service'
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
    columns: { type: true, role: true, blockedAt: true, testOwnerPrincipalId: true },
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
  // An anonymous session may only upload while the workspace takes anonymous
  // posts and comments, the same switch that gates what the upload is for. A
  // teammate's test customer is exempt, as it is when it posts.
  if (
    principalRecord.type === 'anonymous' &&
    !principalRecord.testOwnerPrincipalId &&
    !(await getPortalConfig()).features.allowAnonymous
  ) {
    return Response.json({ error: 'Anonymous interaction is not enabled' }, { status: 403 })
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
