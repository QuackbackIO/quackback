/**
 * Customer-context enrichment (IF WO-9). Fetches normalized context cards from
 * every connected integration that provides a `context` capability
 * (zendesk/hubspot/intercom today), looked up by email on demand. Providers
 * that error or don't match are simply omitted.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuth } from './auth-helpers'
import type { EnrichmentCard } from '@/lib/server/integrations/types'
import { PERMISSIONS } from '@/lib/shared/permissions'

const schema = z.object({ email: z.string().email() })

export type { EnrichmentCard }

export const fetchCustomerContextFn = createServerFn({ method: 'POST' })
  .validator(schema)
  .handler(async ({ data }): Promise<EnrichmentCard[]> => {
    await requireAuth({ permission: PERMISSIONS.INTEGRATION_VIEW })

    const { fetchCustomerContext } = await import('@/lib/server/integrations/context')
    return fetchCustomerContext(data.email)
  })
