/**
 * Freshdesk-specific server functions.
 * Freshdesk uses API key + subdomain (no OAuth).
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

/**
 * Save Freshdesk API key and subdomain.
 */
export const saveFreshdeskKeyFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      apiKey: z.string().min(1),
      subdomain: z
        .string()
        .min(1)
        .regex(/^[a-z0-9-]+$/),
    })
  )
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { saveIntegration } = await import('../save')

    const auth = await requireAuth({ roles: ['admin'] })

    // Verify the credentials work
    const response = await fetch(
      `https://${data.subdomain}.freshdesk.com/api/v2/settings/helpdesk`,
      {
        headers: { Authorization: `Basic ${btoa(`${data.apiKey}:X`)}` },
      }
    )

    if (!response.ok) {
      throw new Error(`Invalid Freshdesk credentials: HTTP ${response.status}`)
    }

    const helpdesk = (await response.json()) as { name?: string }

    await saveIntegration('freshdesk', {
      principalId: auth.principal.id,
      accessToken: data.apiKey,
      config: {
        subdomain: data.subdomain,
        workspaceName: helpdesk.name || `${data.subdomain}.freshdesk.com`,
      },
    })

    return { success: true }
  })
