import { createFileRoute } from '@tanstack/react-router'
import { auth } from '@/lib/server/auth'
import { isS3Usable, uploadMediaFromFormData } from '@/lib/server/storage/s3'
import { enforceWidgetQuota, widgetJsonError } from '@/lib/server/widget/public-endpoint'
import { getSettings } from '@/lib/server/functions/workspace'
import type { UserId } from '@quackback/ids'
import { db, eq, principal } from '@/lib/server/db'
import { isBlockedCustomer } from '@/lib/server/domains/principals/blocking'
import { PERSON_BLOCKED_CODE, PERSON_BLOCKED_MESSAGE } from '@/lib/shared/person-blocked'
import {
  ANONYMOUS_UPLOAD_REFUSED,
  mayUploadPostMedia,
} from '@/lib/server/storage/anonymous-upload-gate'

export async function handleWidgetUpload({ request }: { request: Request }): Promise<Response> {
  // A valid widget session may attach images: identified, or anonymous while
  // the workspace takes anonymous posts. We
  // resolve the Bearer the same way server functions do: the better-auth bearer
  // plugin strips the token signature and looks up the session (a raw
  // `session.token` equality check fails because the bearer value is signed).
  // The Bearer is the widget's only credential: the lookup sees that header
  // alone, so a session cookie the frame's request also carries (a same-site
  // embedder) never stands in for it.
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sessionData = await auth.api.getSession({ headers: new Headers({ authorization }) })
  if (!sessionData?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // A blocked person adds no media to posts or comments (blocking.ts). The
  // messenger's attachments go through /api/widget/files, which is unchanged.
  const person = await db.query.principal.findFirst({
    where: eq(principal.userId, sessionData.user.id as UserId),
    columns: { id: true, type: true, role: true, blockedAt: true },
  })
  if (person && isBlockedCustomer(person)) {
    return Response.json(
      { error: PERSON_BLOCKED_MESSAGE, code: PERSON_BLOCKED_CODE },
      { status: 403 }
    )
  }
  // An anonymous widget session uploads only while anonymous posting is on.
  if (person && !(await mayUploadPostMedia(person))) {
    return Response.json(ANONYMOUS_UPLOAD_REFUSED, { status: 403 })
  }
  // Key the workspace bucket on the resolved workspace, not the `Host` header:
  // the header is caller-controlled, so varying it would let an attacker
  // spin up a fresh per-workspace bucket on every request.
  const settings = await getSettings()
  if (!settings) return widgetJsonError(503, 'WORKSPACE_UNAVAILABLE', 'Workspace unavailable')
  const limited = await enforceWidgetQuota(request, {
    keyPrefix: 'widget-upload',
    workspaceKey: settings.id,
    limit: 20,
    workspaceLimit: 200,
    windowSeconds: 60,
    message: 'Too many uploads, slow down',
  })
  if (limited) return limited
  if (!isS3Usable()) {
    return Response.json({ error: 'Storage not configured' }, { status: 503 })
  }
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }
  return uploadMediaFromFormData(formData, 'widget-media')
}

export const Route = createFileRoute('/api/widget/upload')({
  server: {
    handlers: {
      POST: handleWidgetUpload,
    },
  },
})
