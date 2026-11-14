/**
 * Telling the people who manage the workspace's domains when a verified
 * domain added by name loses its ownership record: a warning with the date it
 * has to be back by, and a notice when the domain stops being verified, naming
 * the sign-in domains that stopped with it.
 *
 * Recipients are every teammate holding `settings.manage`, the permission that
 * adds and removes a domain and also manages sending, so they are the sending
 * domain managers. A bell for each, respecting their in-app
 * preference, and an email, respecting their email preference. A failure here
 * is logged and never undoes what it reports; the warning says whether it was
 * delivered, so the watch can try again.
 */
import type { Domain } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import {
  emailEachManager,
  formatDeadline,
  ringManagers,
  sendingDomainManagers,
  type Manager,
} from '@/lib/server/domains/channel-accounts/sending-domain-notify'
import {
  OWNERSHIP_RECORD_HOST,
  ownershipRecord,
} from '@/lib/server/domains/channel-accounts/sending-domain-records'
import { recordName } from '@/lib/server/domains/channel-accounts/record-check'

const log = logger.child({ component: 'domain-ownership-notify' })

const TYPE = 'domain_needs_attention' as const

type NotifiedDomain = Pick<Domain, 'name' | 'ownershipToken'>

/** What the notice says beyond the domain and its record. */
interface AttentionContent {
  deadline?: string
  signInDomains?: string[]
}

function recordOf(domain: NotifiedDomain) {
  return {
    name: recordName(domain.name, OWNERSHIP_RECORD_HOST),
    value: ownershipRecord(domain.ownershipToken).value,
  }
}

/** Ring the bell for every manager whose preference allows it. */
async function ring(
  managers: Manager[],
  domain: NotifiedDomain,
  title: string,
  content: AttentionContent
): Promise<void> {
  const { domainAttentionMessage } = await import('@quackback/email')
  await ringManagers(managers, TYPE, {
    title,
    body: domainAttentionMessage({
      domain: domain.name,
      recordName: recordOf(domain).name,
      ...content,
    }),
    metadata: { domain: domain.name, audience: 'admin' },
  })
}

/**
 * Email every manager whose preference allows it. False only when emails were
 * due and every one failed.
 */
async function emailManagers(
  managers: Manager[],
  domain: NotifiedDomain,
  content: AttentionContent
): Promise<boolean> {
  const { sendDomainAttentionEmail } = await import('@quackback/email')
  return emailEachManager(
    managers,
    TYPE,
    (to, { base, workspaceName }) =>
      sendDomainAttentionEmail({
        to,
        domain: domain.name,
        record: recordOf(domain),
        ...content,
        settingsUrl: base
          ? `${base}/admin/settings/domains/${encodeURIComponent(domain.name)}`
          : null,
        workspaceName,
      }),
    { logContext: { domain: domain.name }, message: 'domain attention email failed' }
  )
}

/**
 * The record went missing: a bell per manager and an email with the date it
 * has to be back by. The bell rings only with `ring`, which the watch sets on
 * the first try for a warning, so an email tried again does not ring it again.
 * Resolves true once at least one email went out (or none was due).
 */
export async function notifyDomainOwnershipMissing(
  domain: NotifiedDomain,
  deadline: Date,
  opts: { ring: boolean }
): Promise<boolean> {
  try {
    const managers = await sendingDomainManagers()
    if (managers.length === 0) return true
    const by = formatDeadline(deadline)
    if (opts.ring) await ring(managers, domain, `${domain.name} needs attention`, { deadline: by })
    return await emailManagers(managers, domain, { deadline: by })
  } catch (err) {
    log.warn({ err, domain: domain.name }, 'domain ownership warning notification failed')
    return false
  }
}

/** The record stayed missing and the domain is no longer verified. */
export async function notifyDomainOwnershipLapsed(
  domain: NotifiedDomain,
  signInDomains: string[]
): Promise<void> {
  try {
    const managers = await sendingDomainManagers()
    if (managers.length === 0) return
    await ring(managers, domain, `${domain.name} is no longer verified`, { signInDomains })
    await emailManagers(managers, domain, { signInDomains })
  } catch (err) {
    log.warn({ err, domain: domain.name }, 'domain ownership lapse notification failed')
  }
}
