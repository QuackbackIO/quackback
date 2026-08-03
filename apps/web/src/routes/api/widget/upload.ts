import { createFileRoute } from '@tanstack/react-router'
import { auth } from '@/lib/server/auth'
import { isS3Configured, uploadImageFromFormData } from '@/lib/server/storage/s3'
import { getWidgetConfig } from '@/lib/server/domains/settings/settings.widget'
import { getPublicOriginFromRequest } from '@/lib/server/integrations/oauth'

export async function handleWidgetUpload({ request }: { request: Request }): Promise<Response> {
  // Any valid widget session may attach images - identified or anonymous. We
  // resolve the Bearer the same way server functions do: the better-auth bearer
  // plugin strips the token signature and looks up the session (a raw
  // `session.token` equality check fails because the bearer value is signed).
  const sessionData = await auth.api.getSession({ headers: request.headers })
  if (!sessionData?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
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
  return uploadImageFromFormData(formData, 'widget-images', getPublicOriginFromRequest(request))
}

export const Route = createFileRoute('/api/widget/upload')({
  server: {
    handlers: {
      POST: handleWidgetUpload,
    },
  },
})
