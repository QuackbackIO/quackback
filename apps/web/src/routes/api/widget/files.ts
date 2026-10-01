import { createFileRoute } from '@tanstack/react-router'
import { getWidgetSession } from '@/lib/server/functions/widget-auth'
import { getSettings } from '@/lib/server/functions/workspace'
import { enforceWidgetQuota, widgetJsonError } from '@/lib/server/widget/public-endpoint'
import { handleFileUploadRequest } from '@/lib/server/domains/files/files.upload'

/**
 * POST /api/widget/files?name=<file name> — a widget visitor attaching a file.
 *
 * Any widget session may upload, identified or anonymous. An anonymous
 * visitor's identity is unverified, so executables and scripts are refused.
 */
export async function handleWidgetFileUpload({ request }: { request: Request }): Promise<Response> {
  const session = await getWidgetSession()
  if (!session) return widgetJsonError(401, 'AUTH_REQUIRED', 'Valid widget session required')
  // Key the workspace bucket on the resolved workspace, not the caller's Host.
  const settings = await getSettings()
  if (!settings) return widgetJsonError(503, 'WORKSPACE_UNAVAILABLE', 'Workspace unavailable')
  const limited = await enforceWidgetQuota(request, {
    keyPrefix: 'widget-file-upload',
    workspaceKey: settings.id,
    limit: 20,
    workspaceLimit: 200,
    windowSeconds: 60,
    message: 'Too many uploads, slow down',
  })
  if (limited) return limited
  return handleFileUploadRequest(request, {
    source: 'visitor',
    uploadedById: session.principal.id,
    unverifiedSender: session.principal.type !== 'user',
  })
}

export const Route = createFileRoute('/api/widget/files')({
  server: { handlers: { POST: handleWidgetFileUpload } },
})
