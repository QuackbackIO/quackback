/**
 * ntfy-specific server functions.
 * ntfy uses a topic URL + optional Bearer token (no OAuth).
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { safeFetch } from '@/lib/server/content/ssrf-guard'
import { parseNtfyUrl } from '@/integrations/ntfy/server/url'
import { PERMISSIONS } from '@/lib/shared/permissions'

/**
 * Save an ntfy topic URL (and optional access token) as the integration connection.
 * Sends a test notification to verify the channel is reachable.
 */
export const saveNtfyFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      url: z.string().url().startsWith('https://'),
      token: z.string().optional(),
    })
  )
  .handler(async ({ data }) => {
    const { requireAuth } = await import('@/lib/server/functions/auth-helpers')
    const { saveIntegration } = await import('@/lib/server/integrations/save')

    const auth = await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })

    const parsed = parseNtfyUrl(data.url)
    if (!parsed) {
      throw new Error(
        'Enter a valid ntfy topic URL, e.g. https://ntfy.sh/my-topic (topics may only contain letters, numbers, - and _)'
      )
    }
    const { origin, topic } = parsed

    const testHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
    if (data.token) testHeaders['Authorization'] = `Bearer ${data.token}`

    const testResponse = await safeFetch(`${origin}/`, {
      method: 'POST',
      headers: testHeaders,
      body: JSON.stringify({
        topic,
        title: 'Quackback connected',
        message: 'ntfy notifications are now set up.',
        tags: ['white_check_mark'],
      }),
    })

    if (!testResponse.ok) {
      const status = testResponse.status
      const extra =
        status === 401 || status === 403 ? ' (check the access token / topic permissions)' : ''
      throw new Error(`ntfy test failed: HTTP ${status}${extra}`)
    }

    await saveIntegration('ntfy', {
      principalId: auth.principal.id,
      accessToken: data.token ?? '',
      config: { channelId: data.url, workspaceName: 'ntfy' },
    })

    return { success: true }
  })
