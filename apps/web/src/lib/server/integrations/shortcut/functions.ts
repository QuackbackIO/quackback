/**
 * Shortcut-specific server functions.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

export interface ShortcutProject {
  id: string
  name: string
}

export const saveShortcutTokenFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ apiToken: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { saveIntegration } = await import('../save')

    const auth = await requireAuth({ roles: ['admin'] })

    // Validate the token by calling Shortcut's member-info endpoint
    const response = await fetch('https://api.app.shortcut.com/api/v3/member', {
      headers: {
        'Shortcut-Token': data.apiToken,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Invalid API token. Please check your Shortcut API token and try again.')
      }
      throw new Error(`Failed to validate Shortcut token: HTTP ${response.status}`)
    }

    const memberInfo = (await response.json()) as {
      workspace2?: { name: string; url_slug: string }
    }

    const workspaceName = memberInfo.workspace2?.name || 'Shortcut'
    const workspaceSlug = memberInfo.workspace2?.url_slug || ''

    await saveIntegration('shortcut', {
      principalId: auth.principal.id,
      accessToken: data.apiToken,
      config: { workspaceSlug, workspaceName },
    })
  })

export const fetchShortcutProjectsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ShortcutProject[]> => {
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { db, integrations, eq } = await import('@/lib/server/db')
    const { decryptSecrets } = await import('../encryption')
    const { listShortcutProjects } = await import('./projects')

    await requireAuth({ roles: ['admin'] })

    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, 'shortcut'),
    })

    if (!integration?.secrets || integration.status !== 'active') {
      throw new Error('Shortcut not connected')
    }

    const secrets = decryptSecrets<{ accessToken: string }>(integration.secrets)
    return listShortcutProjects(secrets.accessToken)
  }
)
