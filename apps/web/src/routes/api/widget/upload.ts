import { createFileRoute } from '@tanstack/react-router'
import { db, session, principal, eq, and, gt } from '@/lib/server/db'
import { isS3Configured, uploadImageFromFormData } from '@/lib/server/storage/s3'
import { getWidgetConfig } from '@/lib/server/domains/settings/settings.widget'
import { handleDomainError } from '@/lib/server/domains/api/responses'
import { DomainException } from '@/lib/shared/errors'

export async function handleWidgetUpload({ request }: { request: Request }): Promise<Response> {
  // Block writes from suspended/deleting workspaces. Read-only widget
  // routes (config, search, kb-search) stay open so end-users see a
  // working portal even while the workspace is past-due.
  try {
    const { ensureNotSuspended } = await import('@/lib/server/middleware/suspension-guard')
    await ensureNotSuspended()
  } catch (e) {
    if (e instanceof DomainException) return handleDomainError(e)
    throw e
  }
  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // Strip HMAC suffix: portal session cookies are `{token}.{hmac}`, DB stores bare token.
  const token = authHeader.slice(7).split('.')[0]
  const sessionRecord = await db.query.session.findFirst({
    where: and(eq(session.token, token), gt(session.expiresAt, new Date())),
  })
  if (!sessionRecord) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const principalRecord = await db.query.principal.findFirst({
    where: eq(principal.userId, sessionRecord.userId),
  })
  if (!principalRecord || principalRecord.type === 'anonymous') {
    return Response.json({ error: 'Authentication required to upload images' }, { status: 403 })
  }
  const widgetConfig = await getWidgetConfig()
  if (!widgetConfig.imageUploadsInWidget) {
    return Response.json({ error: 'Image uploads are disabled' }, { status: 403 })
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
  return uploadImageFromFormData(formData, 'widget-images')
}

export const Route = createFileRoute('/api/widget/upload')({
  server: {
    handlers: {
      POST: handleWidgetUpload,
    },
  },
})
