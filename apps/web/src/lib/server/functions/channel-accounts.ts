/**
 * Server functions for the email channel settings (support platform §4.8): the
 * workspace inbound route, the sending addresses, which of them each kind of
 * email sends from, and verified sending domains. Gated on channel_account.manage. Scoped to the workspace default team
 * (the v0 owns email config at the workspace level). Returns JSON-safe DTOs.
 */
import { ValidationError, ConflictError, ServiceUnavailableError } from '@/lib/shared/errors'
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { ChannelAccountId, SendingDomainId, TeamId } from '@quackback/ids'
import {
  EMAIL_SENDER_SURFACES,
  type ChannelAccount,
  type EmailSendingDomain,
} from '@/lib/server/db'
import { assertAnyPermission, requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  SUPPORT_SENDER_PERMISSIONS,
  SURFACE_SENDER_READ_PERMISSIONS,
} from '@/lib/shared/email-sending-permissions'
import {
  bareSenderAddress,
  resolveSender,
} from '@/lib/server/domains/channel-accounts/sender-resolver'
import {
  defaultTeamId,
  getInboundRoute,
  listChannelAccounts,
  listSendingDomains,
  setInboundForwardingTarget,
  deleteSendingDomain,
  updateInboundTrust,
  clearInboundForwarding,
  updateSendingAddressName,
} from '@/lib/server/domains/channel-accounts/channel-account.service'
import {
  getEmailSenders,
  setEmailSender,
  type EmailSenderSurface,
} from '@/lib/server/domains/channel-accounts/email-senders'
import {
  isSendingIdentityPermitted,
  sendingIdentityContext,
} from '@/lib/server/domains/channel-accounts/outbound-identity'
import { platformInboxAddress } from '@/lib/server/domains/conversation/conversation.email-channel'
import { currentMailSlug } from '@/lib/server/domains/conversation/conversation.mail-slug'
import {
  SendingDomainRefusedError,
  restartSendingDomainChecks,
} from '@/lib/server/domains/channel-accounts/sending-identity'
import { ownershipGraceEnds } from '@/lib/server/domains/channel-accounts/ownership-grace'
import {
  addSendingAddress,
  removeSendingAddress,
  sendTestEmail,
  addressModeFor,
} from '@/lib/server/domains/channel-accounts/sending-address'
import {
  domainActionMessage,
  isDomainActionRefusal,
  type DomainAction,
} from '@/lib/server/domains/channel-accounts/domain-action-message'
import { sesTenantPausedNotice } from '@/lib/server/domains/channel-accounts/ses-tenant-status'
import { enqueueSesTenantReconcile } from '@/lib/server/domains/channel-accounts/ses-tenant-queue'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'channel-accounts-fn' })

/**
 * Run a sending-domain action, replacing its failure with the sentence a person
 * may read (see `domain-action-message.ts`).
 *
 * The cause is kept even though only the message crosses the wire, and anything
 * that is not one of our own refusals is logged here with it: the provider's
 * own text is read in the server log, by the operator who can act on it.
 */
async function withDomainActionMessage<T>(action: DomainAction, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (!isDomainActionRefusal(error)) {
      log.error({ err: error, action }, 'sending domain action failed')
      throw new ServiceUnavailableError(
        'SENDING_DOMAIN_ACTION_FAILED',
        domainActionMessage(error, action),
        error
      )
    }
    throw new ValidationError(
      'SENDING_DOMAIN_ACTION_REFUSED',
      domainActionMessage(error, action),
      error
    )
  }
}

/** What our own lookup last found for a record (see `record-check.ts`). */
export type DnsRecordCheckDTO = {
  state: 'found' | 'missing' | 'mismatch' | 'proxied'
  seen?: string
  reason?: 'doubled-name' | 'truncated' | 'quoted'
  checkedAt: string
}

/** A record to publish, flattened for the wire. `priority` is present on MX only. */
export type DnsRecordDTO = {
  type: string
  host: string
  value: string
  purpose: string
  priority?: number
  check?: DnsRecordCheckDTO
}

// createServerFn requires serializable returns; the jsonb config is JSON at
// runtime, so it's typed as JSON (not Record<string, unknown>).
type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }
type JsonObject = { [k: string]: JsonValue }

export interface ChannelAccountDTO {
  id: string
  role: 'inbound' | 'sending' | 'connection'
  address: string | null
  /** The name mail from it is sent under; null means the workspace name. */
  senderName: string | null
  config: JsonObject
  inboundTrust: 'strict' | 'lenient'
  sendingDomainId: string | null
  sendingDomain: { domain: string; status: string } | null
  /** When the account was added, so the page can tell the oldest on a domain. */
  createdAt: string
}

/**
 * A sending address as the settings page lists it, with the send guard's own
 * answer for it: whether email can leave from it right now. The page shows a
 * domain's progress from the domain, but only the guard knows every way an
 * address is or is not sendable (a verified parent domain, the platform's own
 * address, a server that sends from anything).
 */
export type SendingAddressDTO = ChannelAccountDTO & { sendable: boolean }

/** Pre-flight findings for a domain (see `preflight.ts`). Every field may be absent. */
export interface SendingDomainPreflightDTO {
  dnsHost?: 'cloudflare' | 'route53' | 'godaddy' | 'namecheap' | 'google' | 'other'
  mailFromFree?: boolean
  dmarc?: { found: boolean; policy?: 'none' | 'quarantine' | 'reject' }
  checkedAt?: string
}

export interface SendingDomainDTO {
  id: string
  domain: string
  status: string
  dnsRecords: DnsRecordDTO[]
  verifiedAt: string | null
  /**
   * Set on a verified domain whose ownership record has gone missing: when it
   * stops sending as itself unless the record is added back.
   */
  ownershipDeadline?: string | null
  /** The MAIL FROM subdomain label the records are composed under. */
  mailFromLabel: string
  /**
   * How the domain is signed: `byo` with a key of its own (one TXT, which also
   * proves ownership), `easy` with the provider's keys (CNAMEs plus the
   * ownership TXT), `shared` with the key the identity already had (the row's
   * own key TXT proves ownership only, beside the provider's CNAMEs when that
   * key is the provider's; when that key is one nobody can publish, the row's
   * key is the one to publish and the row becomes `byo` once it is found).
   */
  dkimMode: 'easy' | 'byo' | 'shared'
  /**
   * A `shared` domain whose identity is re-keyed to the row's own key once
   * that key is found: its key TXT is then the signing record, not ownership
   * only. Says only that; the key itself never leaves the server.
   */
  signingKeyPending?: boolean
  /**
   * Until when a pending domain is checked automatically. A pending domain
   * whose window has passed is "not found after 72 hours"; one with no window yet is still being set up.
   */
  autoCheckUntil: string | null
  /** The last full check, provider included. Each record's `check.checkedAt` is its own lookup. */
  lastCheckedAt: string | null
  preflight: SendingDomainPreflightDTO
}

/**
 * A surface's choice of sender: an address by id, or (support) the inbox.
 * `fallbackId` is the address behind the inbox when it has one: what support
 * email leaves from when it is not a reply to the inbox.
 */
export type EmailSenderChoiceDTO =
  { mode: 'address'; id: string } | { mode: 'inbox'; fallbackId?: string }

/** Each surface's choice, or null where nothing is chosen. */
export type EmailSendersDTO = Record<EmailSenderSurface, EmailSenderChoiceDTO | null>

export interface EmailChannelConfigDTO {
  /** The name mail is sent under when an address has none of its own. */
  workspaceName: string
  /** Which address each kind of email sends from. */
  senders: EmailSendersDTO
  /**
   * Whether the forwarded support address may be sent as, or null when nothing
   * is forwarded. Support set to reply from the inbox falls back while it may
   * not, and the page says so.
   */
  forwardingTargetPermitted: boolean | null
  inboundRoute: ChannelAccountDTO | null
  sendingAddresses: SendingAddressDTO[]
  domains: SendingDomainDTO[]
  /**
   * The workspace's own address, which it receives on with nothing configured.
   *
   * Derived on every read rather than read back off the route row, so it is the
   * address the running process would recognise today: the row is written once
   * and an install's inbound domain can move under it, and a stale value here
   * would be a support address a customer publishes and nobody answers. Null
   * when this install has no usable inbound domain, or the workspace no mail
   * slug — in both of which there is no address to name.
   */
  platformAddress: string | null
  /**
   * Which addresses the add form accepts (see `addressModeFor`): any
   * address, addresses whose domain can be set up, or only the default.
   */
  addressMode: 'any' | 'verified-domains' | 'unavailable'
  /**
   * The From email leaves with when no sending address is chosen, as an inbox
   * shows it ("Name <address>"), or null when this install has none configured.
   */
  defaultFrom: string | null
  /**
   * Set when the email provider has paused this workspace's sending, with the
   * provider's reason when it is short. Null while mail sends.
   */
  sendingPaused: { cause: string | null } | null
}

/**
 * The From a workspace's mail carries on the platform address, as an inbox
 * shows it: the send point's own decision, so a page never names it differently.
 */
async function platformFromFor(workspaceName: string | null | undefined): Promise<string | null> {
  const { platformFromPreview } = await import('@quackback/email')
  return platformFromPreview(workspaceName)
}

const toAccount = (a: ChannelAccount, domains: EmailSendingDomain[] = []): ChannelAccountDTO => {
  const domain = a.sendingDomainId
    ? (domains.find((d) => d.id === a.sendingDomainId) ?? null)
    : null
  return {
    id: a.id,
    role: a.role,
    address: a.address,
    senderName: a.senderName,
    config: a.config as JsonObject,
    inboundTrust: a.inboundTrust,
    sendingDomainId: a.sendingDomainId,
    sendingDomain: domain ? { domain: domain.domain, status: domain.status } : null,
    createdAt: a.createdAt.toISOString(),
  }
}

const toDomain = (d: EmailSendingDomain): SendingDomainDTO => ({
  id: d.id,
  domain: d.domain,
  status: d.status,
  // Spread rather than cast: the stored union carries `priority` on MX rows only,
  // and the wire shape says the same thing with an optional field.
  dnsRecords: (d.dnsRecords ?? []).map((r) => ({ ...r })),
  verifiedAt: d.verifiedAt ? d.verifiedAt.toISOString() : null,
  ownershipDeadline:
    d.status === 'verified' && d.ownershipMissingSince
      ? ownershipGraceEnds(d.ownershipMissingSince).toISOString()
      : null,
  mailFromLabel: d.mailFromLabel,
  dkimMode: d.dkimMode,
  signingKeyPending: d.pendingSigningKey != null,
  autoCheckUntil: d.autoCheckUntil ? d.autoCheckUntil.toISOString() : null,
  lastCheckedAt: d.lastCheckedAt ? d.lastCheckedAt.toISOString() : null,
  preflight: { ...d.preflight },
})

async function requireDefaultTeam(): Promise<TeamId> {
  const teamId = await defaultTeamId()
  if (!teamId)
    throw new ConflictError(
      'EMAIL_DEFAULT_TEAM_MISSING',
      'No default team is configured for email.'
    )
  return teamId
}

export const getEmailChannelConfigFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<EmailChannelConfigDTO> => {
    // Read by the workspace Email page and the support inbox page alike.
    assertAnyPermission(await requireAuth(), SUPPORT_SENDER_PERMISSIONS)
    const platformAddress = platformInboxAddress(currentMailSlug())
    // One read of the guard's context answers every "may this be sent as"
    // question on the page. The pure rule, not the send-time check: a page
    // read is not a refused send, and must not log one.
    const guard = await sendingIdentityContext()
    const addressMode = addressModeFor(guard)
    const sendingPaused = await sesTenantPausedNotice()
    const teamId = await defaultTeamId()
    const { requireSettingsCached } = await import('@/lib/server/domains/settings/settings.helpers')
    const workspaceName = (await requireSettingsCached()).name
    const defaultFrom = await platformFromFor(workspaceName)
    const choices = await getEmailSenders()
    const senders = Object.fromEntries(
      EMAIL_SENDER_SURFACES.map((surface) => {
        const choice = choices.get(surface)
        return [
          surface,
          !choice
            ? null
            : choice.mode === 'inbox'
              ? {
                  mode: 'inbox' as const,
                  ...(choice.account ? { fallbackId: choice.account.id } : {}),
                }
              : { mode: 'address' as const, id: choice.account.id },
        ]
      })
    ) as EmailSendersDTO
    if (!teamId) {
      return {
        workspaceName,
        senders,
        forwardingTargetPermitted: null,
        inboundRoute: null,
        sendingAddresses: [],
        domains: [],
        platformAddress,
        addressMode,
        defaultFrom,
        sendingPaused,
      }
    }
    const [inbound, accounts, domains] = await Promise.all([
      getInboundRoute(teamId),
      listChannelAccounts(teamId),
      listSendingDomains(teamId),
    ])
    const forwardingTarget = inbound?.config?.forwardingTarget ?? null
    return {
      workspaceName,
      senders,
      forwardingTargetPermitted: forwardingTarget
        ? isSendingIdentityPermitted(forwardingTarget, guard)
        : null,
      inboundRoute: inbound ? toAccount(inbound, domains) : null,
      sendingAddresses: accounts
        .filter((a) => a.role === 'sending')
        .map((a) => ({
          ...toAccount(a, domains),
          sendable: a.address ? isSendingIdentityPermitted(a.address, guard) : false,
        })),
      domains: domains.map(toDomain),
      platformAddress,
      addressMode,
      defaultFrom,
      sendingPaused,
    }
  }
)

export const createInboundRouteFn = createServerFn({ method: 'POST' })
  .validator(z.object({ forwardingTarget: z.string().email() }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.CHANNEL_ACCOUNT_MANAGE })
    const teamId = await requireDefaultTeam()
    // Sets the forwarding address ON the workspace's one inbound route, which by
    // now may already exist as the platform default. Adding forwarding is a
    // widening, so nothing the route already answered for is given up.
    return toAccount(
      await setInboundForwardingTarget({
        owningTeamId: teamId,
        forwardingTarget: data.forwardingTarget,
      })
    )
  })

/** A sender name as typed; blank means the workspace name. */
const senderNameSchema = z.string().max(100).nullable().optional()

export const createSendingAddressFn = createServerFn({ method: 'POST' })
  .validator(z.object({ address: z.string().email(), senderName: senderNameSchema }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    const teamId = await requireDefaultTeam()
    // An address on a domain this workspace has not verified brings that
    // domain with it and sends from the default until the domain is live; the
    // send guard reads the domain, so a pending address claims nothing. See
    // `sending-address.ts`.
    return withDomainActionMessage('address', async () => {
      const added = await addSendingAddress({
        owningTeamId: teamId,
        address: data.address,
        senderName: data.senderName ?? null,
      })
      // A workspace's first address becomes its default sender, which is the
      // one time adding an address changes what email sends from: the page
      // says so.
      const madeDefault = (await getEmailSenders()).get('default')?.account?.id === added.id
      return { ...toAccount(added), madeDefault }
    })
  })

export const updateSendingAddressNameFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string(), senderName: senderNameSchema }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    return toAccount(
      await updateSendingAddressName({
        id: data.id as ChannelAccountId,
        senderName: data.senderName ?? null,
      })
    )
  })

export const setEmailSenderFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      surface: z.enum(EMAIL_SENDER_SURFACES),
      choice: z
        .discriminatedUnion('mode', [
          z.object({ mode: z.literal('address'), id: z.string() }),
          z.object({ mode: z.literal('inbox') }),
        ])
        .nullable(),
    })
  )
  .handler(async ({ data }) => {
    // A support lead chooses where support replies come from; every other
    // sender is a workspace setting (EMAIL_SENDING_PERMISSION, written out so
    // the authorization scan can read it).
    if (data.surface === 'support')
      assertAnyPermission(await requireAuth(), SUPPORT_SENDER_PERMISSIONS)
    else await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    const { choice } = data
    await setEmailSender(
      data.surface,
      !choice
        ? null
        : choice.mode === 'inbox'
          ? { mode: 'inbox' }
          : { mode: 'address', channelAccountId: choice.id as ChannelAccountId }
    )
    return { surface: data.surface }
  })

/**
 * The From a kind of email goes out under right now, as an inbox shows it, for
 * the settings page of the product that sends it. Not for a conversation: a
 * thread keeps its own sender (see `resolveSender`).
 */
export const getSurfaceSenderFn = createServerFn({ method: 'GET' })
  .validator(z.object({ surface: z.enum(['feedback', 'changelog', 'status']) }))
  .handler(async ({ data }): Promise<{ from: string | null }> => {
    assertAnyPermission(await requireAuth(), SURFACE_SENDER_READ_PERMISSIONS[data.surface])
    const { requireSettingsCached } = await import('@/lib/server/domains/settings/settings.helpers')
    const workspaceName = (await requireSettingsCached()).name?.trim()
    const resolved = await resolveSender({ surface: data.surface, preview: true })
    if (!resolved) return { from: await platformFromFor(workspaceName) }
    const name = resolved.senderName?.trim() || workspaceName
    const address = bareSenderAddress(resolved.from)
    return { from: name ? `${name} <${address}>` : address }
  })

export const restartSendingDomainChecksFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    // "Verify": a fresh 72 hour window of automatic checks, and one check
    // now, for a domain whose window ran out before its records appeared.
    return withDomainActionMessage('verify', async () => {
      const refreshed = await restartSendingDomainChecks(data.id as SendingDomainId)
      if (!refreshed) throw new SendingDomainRefusedError('That sending domain no longer exists.')
      return toDomain(refreshed)
    })
  })

export const deleteSendingDomainFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    // Removes our row and the plan slot it held. The identity on the shared
    // provider account is deliberately left for an operator to reap; see
    // `deleteSendingDomain` for why nothing here is allowed to delete one.
    await withDomainActionMessage('remove', async () => {
      await deleteSendingDomain(data.id as SendingDomainId)
    })
    // Releases the domain's identity from the workspace's provider tenant,
    // unless another row here still uses it. Off the request path; a no-op
    // when tenants are off.
    await enqueueSesTenantReconcile('sending-domain-removed')
    return { id: data.id }
  })

export const updateInboundTrustFn = createServerFn({ method: 'POST' })
  .validator(z.object({ inboundTrust: z.enum(['strict', 'lenient']) }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.CHANNEL_ACCOUNT_MANAGE })
    const teamId = await requireDefaultTeam()
    return toAccount(
      await updateInboundTrust({ owningTeamId: teamId, inboundTrust: data.inboundTrust })
    )
  })

export const clearInboundForwardingFn = createServerFn({ method: 'POST' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.CHANNEL_ACCOUNT_MANAGE })
  const teamId = await requireDefaultTeam()
  const row = await clearInboundForwarding(teamId)
  return row ? toAccount(row) : null
})

export const deleteChannelAccountFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    // The domain the last address on it was using, so the page can offer to
    // remove that too and free its plan slot.
    const { lastOnDomain } = await removeSendingAddress(data.id as ChannelAccountId)
    return { id: data.id, lastOnDomain }
  })

export const sendTestEmailFn = createServerFn({ method: 'POST' })
  .validator(z.object({ addressId: z.string() }))
  .handler(async ({ data }) => {
    const { user } = await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    // To the person asking and nobody else: the recipient is their own
    // account address, never something the request names.
    const { requireSettingsCached } = await import('@/lib/server/domains/settings/settings.helpers')
    const workspaceName = (await requireSettingsCached()).name
    return withDomainActionMessage('test', () =>
      sendTestEmail({
        addressId: data.addressId as ChannelAccountId,
        userId: user.id,
        workspaceName,
      })
    )
  })

export const listRecentEmailLogFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.CHANNEL_ACCOUNT_MANAGE })
  const { listRecentEmailLog } = await import('@/lib/server/email/email-log.query')
  return listRecentEmailLog(50)
})
