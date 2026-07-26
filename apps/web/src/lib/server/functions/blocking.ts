/**
 * Server functions for blocking a person (support platform §4.6). Blocking is a
 * moderation action on end users (portal users, leads, anonymous visitors), so
 * it is gated on `people.manage`; reading a block state needs only `people.view`.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { PrincipalId } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'

const principalIdSchema = z.object({ principalId: z.string() })

/** Current block state of a person (for the People / conversation UI). */
export const getPersonBlockStatusFn = createServerFn({ method: 'GET' })
  .validator(principalIdSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.PEOPLE_VIEW })
    const { getBlockStatus } = await import('@/lib/server/domains/principals/blocking')
    return getBlockStatus(data.principalId as PrincipalId)
  })

/** Block a person: reject their future messages and re-registration. */
export const blockPersonFn = createServerFn({ method: 'POST' })
  .validator(principalIdSchema)
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.PEOPLE_MANAGE })
    const { block } = await import('@/lib/server/domains/principals/blocking')
    await block(data.principalId as PrincipalId, ctx.principal.id)
    return { ok: true }
  })

/** Unblock a person previously blocked. */
export const unblockPersonFn = createServerFn({ method: 'POST' })
  .validator(principalIdSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.PEOPLE_MANAGE })
    const { unblock } = await import('@/lib/server/domains/principals/blocking')
    await unblock(data.principalId as PrincipalId)
    return { ok: true }
  })
