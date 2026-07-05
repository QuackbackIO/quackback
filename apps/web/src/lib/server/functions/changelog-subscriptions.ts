/**
 * Server functions for the changelog subscriber pipeline (Changelog Settings
 * §2): self-serve subscribe/unsubscribe, admin CSV import, and the per-user
 * status lookup consumed by the People directory profile.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { requireAuth } from './auth-helpers'
import {
  subscribeSelfServe,
  unsubscribeChangelog,
  subscribeAdmin,
  getChangelogSubscriptionStatus,
  importChangelogSubscribersFromEmails,
} from '@/lib/server/domains/changelog/changelog-subscription.service'
import type { PrincipalId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'changelog-subscriptions' })

/** Self-serve Subscribe button on the public changelog page. */
export const subscribeToChangelogFn = createServerFn({ method: 'POST' }).handler(async () => {
  const auth = await requireAuth()
  await subscribeSelfServe(auth.principal.id)
  return { subscribed: true }
})

/** Self-serve unsubscribe from the same button (toggle). */
export const unsubscribeFromChangelogFn = createServerFn({ method: 'POST' }).handler(async () => {
  const auth = await requireAuth()
  await unsubscribeChangelog(auth.principal.id)
  return { subscribed: false }
})

/** The signed-in caller's own subscription status, for the Subscribe button. */
export const getMyChangelogSubscriptionFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    const auth = await requireAuth()
    return getChangelogSubscriptionStatus(auth.principal.id)
  }
)

const principalIdSchema = z.object({ principalId: z.string() })

/** People-directory per-user status + toggle (admin only). */
export const getChangelogSubscriptionStatusFn = createServerFn({ method: 'GET' })
  .validator(principalIdSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.PEOPLE_VIEW })
    return getChangelogSubscriptionStatus(data.principalId as PrincipalId)
  })

export const setChangelogSubscriptionFn = createServerFn({ method: 'POST' })
  .validator(z.object({ principalId: z.string(), subscribed: z.boolean() }))
  .handler(async ({ data }) => {
    log.debug(data, 'admin set changelog subscription')
    await requireAuth({ permission: PERMISSIONS.PEOPLE_MANAGE })
    const principalId = data.principalId as PrincipalId
    if (data.subscribed) {
      await subscribeAdmin(principalId)
    } else {
      await unsubscribeChangelog(principalId)
    }
    return getChangelogSubscriptionStatus(principalId)
  })

const csvImportSchema = z.object({
  emails: z.array(z.string()).max(5000),
})

/**
 * Admin CSV import of subscriber emails. The consent-warning copy is shown
 * in the settings UI before this runs — the server trusts the caller has
 * confirmed it (`changelog.manage` gates who can even reach the control).
 */
export const importChangelogSubscribersFn = createServerFn({ method: 'POST' })
  .validator(csvImportSchema)
  .handler(async ({ data }) => {
    log.info({ count: data.emails.length }, 'import changelog subscribers from CSV')
    await requireAuth({ permission: PERMISSIONS.CHANGELOG_MANAGE })
    return importChangelogSubscribersFromEmails(data.emails)
  })
