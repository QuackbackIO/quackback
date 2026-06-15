/**
 * ntfy-specific server functions.
 * ntfy uses a topic URL + optional Bearer token (no OAuth).
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { safeFetch } from '../../content/ssrf-guard'

/**
 * Save an ntfy topic URL (and optional access token) as the integration connection.
 * Sends a test notification to verify the channel is reachable.
 */
export const saveNtfyFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      url: z.string().url().startsWith('https://'),
      token: z.string().optional(),
    })
  )
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { saveIntegration } = await import('../save')

    const auth = await requireAuth({ roles: ['admin'] })

    const u = new URL(data.url)
    const topic = u.pathname.replace(/^\/+/, '')
    if (!topic) {
      throw new Error('The ntfy URL must include a topic, e.g. https://ntfy.sh/my-topic')
    }

    const testHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
    if (data.token) testHeaders['Authorization'] = `Bearer ${data.token}`

    const testResponse = await safeFetch(`${u.origin}/`, {
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
      const extra = status === 401 || status === 403 ? ' (check the access token / topic permissions)' : ''
      throw new Error(`ntfy test failed: HTTP ${status}${extra}`)
    }

    await saveIntegration('ntfy', {
      principalId: auth.principal.id,
      accessToken: data.token ?? '',
      config: { channelId: data.url, workspaceName: 'ntfy' },
    })

    return { success: true }
  })
