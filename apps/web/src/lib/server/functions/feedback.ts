/**
 * Server functions for post-to-post merge suggestions (accept / dismiss).
 *
 * These back the "similar posts" merge card on the post modal. The AI
 * feedback-extraction pipeline and its feedback suggestions were removed with
 * the labs subsystem, so only merge suggestions remain here.
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { PrincipalId } from '@quackback/ids'
import { isTypeId } from '@quackback/ids'

import { requireAuth } from './auth-helpers'
import { withErrorLog } from './with-error-log'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'feedback' })

const acceptSuggestionSchema = z.object({
  id: z.string(),
  swapDirection: z.boolean().optional(),
})

const dismissSuggestionSchema = z.object({
  id: z.string(),
})

export const acceptSuggestionFn = createServerFn({ method: 'POST' })
  .validator(acceptSuggestionSchema)
  .handler(async ({ data }) => {
    log.debug({ suggestion_id: data.id, swap_direction: data.swapDirection }, 'accept suggestion')
    return withErrorLog(log, 'accept suggestion', async () => {
      const auth = await requireAuth({ permission: PERMISSIONS.SUGGESTION_MANAGE })

      if (!isTypeId(data.id, 'post_merge_sug')) {
        return { success: false, error: 'Invalid merge suggestion id' }
      }

      const { acceptMergeSuggestion } =
        await import('@/lib/server/domains/merge-suggestions/merge-suggestion.service')
      await acceptMergeSuggestion(data.id, auth.principal.id as PrincipalId, {
        swapDirection: data.swapDirection,
      })
      return { success: true }
    })
  })

export const dismissSuggestionFn = createServerFn({ method: 'POST' })
  .validator(dismissSuggestionSchema)
  .handler(async ({ data }) => {
    log.debug({ suggestion_id: data.id }, 'dismiss suggestion')
    return withErrorLog(log, 'dismiss suggestion', async () => {
      const auth = await requireAuth({ permission: PERMISSIONS.SUGGESTION_MANAGE })

      if (!isTypeId(data.id, 'post_merge_sug')) {
        return { success: false, error: 'Invalid merge suggestion id' }
      }

      const { dismissMergeSuggestion } =
        await import('@/lib/server/domains/merge-suggestions/merge-suggestion.service')
      await dismissMergeSuggestion(data.id, auth.principal.id as PrincipalId)
      return { success: true }
    })
  })
