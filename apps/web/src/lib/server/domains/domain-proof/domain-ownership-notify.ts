/**
 * Telling the people who manage the workspace's domains when a verified
 * domain added by name loses its ownership record: a warning with the date it
 * has to be back by, and a notice when the domain stops being verified, naming
 * the sign-in domains that stopped with it.
 *
 * Recipients are every teammate holding `settings.manage`, the permission that
 * adds and removes a domain. A bell for each, respecting their in-app
 * preference, and an email, respecting their email preference. A failure here
 * is logged and never undoes what it reports; the warning says whether it was
 * delivered, so the watch can try again.
 */
import type { Domain } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { batchGetNotificationPreferences } from '@/lib/server/domains/subscriptions/subscription.service'
import { shouldNotify } from '@/lib/server/domains/subscriptions/notification-matrix'
import {
  formatDeadline,
  managersHolding,
  ringManagers,
  type Manager,
} from '@/lib/server/domains/channel-accounts/sending-domain-notify'
import { OWNERSHIP_RECORD_HOST } from '@/lib/server/domains/channel-accounts/sending-domain-records'
import { domainOwnershipValue } from './domains.service'

const log = logger.child({ component: 'domain-ownership-notify' })

const TYPE = 'domain_needs_attention' as const

/** Every teammate who may add or remove the workspace's domains. */
function domainManagers(): Promise<Manager[]> {
  return managersHolding(PERMISSIONS.SETTINGS_MANAGE)
}

function recordOf(domain: Pick<Domain, 'name' | 'ownershipToken'>) {
  return {
    name: `${OWNERSHIP_RECORD_HOST}.${domain.name}`,
    value: domainOwnershipValue(domain.ownershipToken),
  }
}

/**
 * Email every manager whose preference allows it. False only when emails were
 * due and every one failed.
 */
async function emailManagers(
  managers: Manager[],
  domain: Pick<Domain, 'name' | 'ownershipToken'>,
  content: { deadline?: string; signInDomains?: string[] }
): Promise<boolean> {
  const { sendDomainAttentionEmail, isEmailConfigured } = await import('@quackback/email')
  if (!isEmailConfigured()) return true
  const prefs = await batchGetNotificationPreferences(managers.map((m) => m.principalId))
  const { resolveAccountRecipient } = await import('@/lib/server/email/recipient')
  const { getWorkspaceSettings } = await import('@/lib/server/domains/settings/settings.service')
  const { getBaseUrl } = await import('@/lib/server/config')
  const workspace = await getWorkspaceSettings()
  const base = getBaseUrl().replace(/\/$/, '')
  let due = 0
  let sent = 0
  for (const manager of managers) {
    const p = prefs.get(manager.principalId)
    if (p && !shouldNotify(p, TYPE, 'email')) continue
    if (!manager.userId) continue
    const to = await resolveAccountRecipient(manager.userId)
    if (!to) continue
    due += 1
    try {
      await sendDomainAttentionEmail({
        to,
        domain: domain.name,
        record: recordOf(domain),
        ...content,
        settingsUrl: base
          ? `${base}/admin/settings/domains/${encodeURIComponent(domain.name)}`
          : null,
        workspaceName: workspace?.settings?.name,
      })
      sent += 1
    } catch (err) {
      log.warn(
        { err, domain: domain.name, principal_id: manager.principalId },
        'domain attention email failed'
      )
    }
  }
  return due === 0 || sent > 0
}

/**
 * The record went missing: a bell per manager and an email with the date it
 * has to be back by. The bell rings only with `ring`, which the watch sets on
 * the first try for a warning, so an email tried again does not ring it again.
 * Resolves true once at least one email went out (or none was due).
 */
export async function notifyDomainOwnershipMissing(
  domain: Pick<Domain, 'name' | 'ownershipToken'>,
  deadline: Date,
  opts: { ring: boolean }
): Promise<boolean> {
  try {
    const managers = await domainManagers()
    if (managers.length === 0) return true
    const by = formatDeadline(deadline)
    if (opts.ring) {
      const { domainAttentionMessage } = await import('@quackback/email')
      await ringManagers(managers, TYPE, {
        title: `${domain.name} needs attention`,
        body: domainAttentionMessage({
          domain: domain.name,
          recordName: recordOf(domain).name,
          deadline: by,
        }),
        metadata: { domain: domain.name, audience: 'admin' },
      })
    }
    return await emailManagers(managers, domain, { deadline: by })
  } catch (err) {
    log.warn({ err, domain: domain.name }, 'domain ownership warning notification failed')
    return false
  }
}

/** The record stayed missing and the domain is no longer verified. */
export async function notifyDomainOwnershipLapsed(
  domain: Pick<Domain, 'name' | 'ownershipToken'>,
  signInDomains: string[]
): Promise<void> {
  try {
    const managers = await domainManagers()
    if (managers.length === 0) return
    const { domainAttentionMessage } = await import('@quackback/email')
    await ringManagers(managers, TYPE, {
      title: `${domain.name} is no longer verified`,
      body: domainAttentionMessage({
        domain: domain.name,
        recordName: recordOf(domain).name,
        signInDomains,
      }),
      metadata: { domain: domain.name, audience: 'admin' },
    })
    await emailManagers(managers, domain, { signInDomains })
  } catch (err) {
    log.warn({ err, domain: domain.name }, 'domain ownership lapse notification failed')
  }
}
