/**
 * Server functions for the email channel settings (support platform §4.8): the
 * workspace inbound route, per-module sending addresses, and verified sending
 * domains. Gated on channel_account.manage. Scoped to the workspace default team
 * (the v0 owns email config at the workspace level). Returns JSON-safe DTOs.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { ChannelAccountId, SendingDomainId, TeamId } from '@quackback/ids'
import type { ChannelAccount, EmailSendingDomain } from '@/lib/server/db'
import { db, eq, teams } from '@/lib/server/db'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  getInboundRoute,
  listChannelAccounts,
  listSendingDomains,
  createInboundRoute,
  createSendingAddress,
  deleteSendingDomain,
  softDeleteChannelAccount,
} from '@/lib/server/domains/channel-accounts/channel-account.service'
import {
  SendingDomainRefusedError,
  provisionSendingDomain,
  refreshSendingDomain,
} from '@/lib/server/domains/channel-accounts/sending-identity'
import {
  SendingIdentityRefusedError,
  assertSendingIdentityPermitted,
} from '@/lib/server/domains/channel-accounts/outbound-identity'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'channel-accounts-fn' })

/**
 * The message a person is allowed to see for a failed sending-domain action.
 *
 * Our own refusals are written for the person reading them and name the fix, so
 * they pass through. Everything else is a provider or transport failure whose
 * text is the provider's prose about its own API — it names actions, exception
 * types and services this person did not ask about and cannot act on, and
 * putting it in a toast turns an operator problem into a customer-facing
 * mystery written in a vendor's voice. The detail is not lost: it is already in
 * the server log, which is where the person who can act on it is looking.
 */
function domainActionMessage(error: unknown, fallback: string): string {
  if (
    error instanceof SendingDomainRefusedError ||
    error instanceof SendingIdentityRefusedError ||
    error instanceof TierLimitError
  ) {
    return error.message
  }
  log.error({ err: error }, 'sending domain action failed')
  return fallback
}

/** Run a sending-domain action, replacing any non-refusal failure's message. */
async function withDomainActionMessage<T>(fallback: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    // The cause is kept even though only the message crosses the wire: the
    // server-side log line below the throw is where the provider's own text is
    // read, and losing the chain there would leave nobody able to answer the
    // question the toast is deliberately not answering.
    throw new Error(domainActionMessage(error, fallback), { cause: error })
  }
}

/** A record to publish, flattened for the wire. `priority` is present on MX only. */
type DnsRecord = {
  type: string
  host: string
  value: string
  purpose: string
  priority?: number
}

// createServerFn requires serializable returns; the jsonb config is JSON at
// runtime, so it's typed as JSON (not Record<string, unknown>).
type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }
type JsonObject = { [k: string]: JsonValue }

export interface ChannelAccountDTO {
  id: string
  role: 'inbound' | 'sending'
  address: string | null
  module: string | null
  config: JsonObject
}

export interface SendingDomainDTO {
  id: string
  domain: string
  status: string
  dnsRecords: DnsRecord[]
  verifiedAt: string | null
}

export interface EmailChannelConfigDTO {
  inboundRoute: ChannelAccountDTO | null
  sendingAddresses: ChannelAccountDTO[]
  domains: SendingDomainDTO[]
}

const toAccount = (a: ChannelAccount): ChannelAccountDTO => ({
  id: a.id,
  role: a.role,
  address: a.address,
  module: a.module,
  config: a.config as JsonObject,
})

const toDomain = (d: EmailSendingDomain): SendingDomainDTO => ({
  id: d.id,
  domain: d.domain,
  status: d.status,
  // Spread rather than cast: the stored union carries `priority` on MX rows only,
  // and the wire shape says the same thing with an optional field.
  dnsRecords: (d.dnsRecords ?? []).map((r) => ({ ...r })),
  verifiedAt: d.verifiedAt ? d.verifiedAt.toISOString() : null,
})

/** The workspace's default team owns email config in the v0. */
async function defaultTeamId(): Promise<TeamId | null> {
  const [row] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.isDefault, true))
    .limit(1)
  return row?.id ?? null
}

async function requireDefaultTeam(): Promise<TeamId> {
  const teamId = await defaultTeamId()
  if (!teamId) throw new Error('No default team is configured for email.')
  return teamId
}

export const getEmailChannelConfigFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<EmailChannelConfigDTO> => {
    await requireAuth({ permission: PERMISSIONS.CHANNEL_ACCOUNT_MANAGE })
    const teamId = await defaultTeamId()
    if (!teamId) return { inboundRoute: null, sendingAddresses: [], domains: [] }
    const [inbound, accounts, domains] = await Promise.all([
      getInboundRoute(teamId),
      listChannelAccounts(teamId),
      listSendingDomains(teamId),
    ])
    return {
      inboundRoute: inbound ? toAccount(inbound) : null,
      sendingAddresses: accounts.filter((a) => a.role === 'sending').map(toAccount),
      domains: domains.map(toDomain),
    }
  }
)

export const createInboundRouteFn = createServerFn({ method: 'POST' })
  .validator(z.object({ forwardingTarget: z.string().email() }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.CHANNEL_ACCOUNT_MANAGE })
    const teamId = await requireDefaultTeam()
    // Record the front door that will actually deliver this route's mail, not a
    // constant. The field is what an operator reads back when mail is not
    // arriving, so naming a transport this deployment does not run sends the
    // next person debugging it to the wrong provider's dashboard.
    const { isCloudflareInboundConfigured } =
      await import('@/lib/server/domains/conversation/email-cloudflare-handler')
    return toAccount(
      await createInboundRoute({
        owningTeamId: teamId,
        config: {
          forwardingTarget: data.forwardingTarget,
          provider: isCloudflareInboundConfigured() ? 'cloudflare' : 'resend',
        },
      })
    )
  })

export const createSendingAddressFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      address: z.string().email(),
      module: z.enum(['support', 'feedback', 'changelog']),
    })
  )
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.CHANNEL_ACCOUNT_MANAGE })
    const teamId = await requireDefaultTeam()
    // Refused here rather than at the send: the mail provider will sign for any
    // identity verified on the account this workspace shares with every other
    // one, so a sending address on a domain this workspace never proved it owns
    // is an impersonation waiting for its first reply. The send path guards this
    // too, and this is where a person is present to read the reason.
    await assertSendingIdentityPermitted(data.address.trim().toLowerCase())
    return toAccount(
      await createSendingAddress({
        owningTeamId: teamId,
        address: data.address,
        module: data.module,
      })
    )
  })

export const createSendingDomainFn = createServerFn({ method: 'POST' })
  .validator(z.object({ domain: z.string().min(3) }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.CHANNEL_ACCOUNT_MANAGE })
    const teamId = await requireDefaultTeam()
    // Creates the provider identity, attaches the custom MAIL FROM, and stores
    // the records the domain's owner has to publish — including the ownership
    // token that is the only thing tying this domain to this workspace.
    return withDomainActionMessage('Could not add the domain. Check the server logs.', async () =>
      toDomain(await provisionSendingDomain({ owningTeamId: teamId, domain: data.domain }))
    )
  })

export const verifySendingDomainFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.CHANNEL_ACCOUNT_MANAGE })
    // Both authorities, re-asked: the provider for whether it will sign, and our
    // own lookup for whether this workspace owns the zone. A domain another
    // workspace verified reads back as verified from the provider, so its answer
    // alone is never enough. See sending-identity.ts.
    return withDomainActionMessage(
      'Could not check the records. Check the server logs.',
      async () => {
        const refreshed = await refreshSendingDomain(data.id as SendingDomainId)
        if (!refreshed) throw new SendingDomainRefusedError('That sending domain no longer exists.')
        return toDomain(refreshed)
      }
    )
  })

export const deleteSendingDomainFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.CHANNEL_ACCOUNT_MANAGE })
    // Removes our row and the plan slot it held. The identity on the shared
    // provider account is deliberately left for an operator to reap; see
    // `deleteSendingDomain` for why nothing here is allowed to delete one.
    await deleteSendingDomain(data.id as SendingDomainId)
    return { id: data.id }
  })

export const deleteChannelAccountFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.CHANNEL_ACCOUNT_MANAGE })
    await softDeleteChannelAccount(data.id as ChannelAccountId)
    return { id: data.id }
  })
