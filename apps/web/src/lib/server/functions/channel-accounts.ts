/**
 * Server functions for the email channel settings (support platform §4.8): the
 * workspace inbound route, per-module sending addresses, and verified sending
 * domains. Gated on channel_account.manage. Scoped to the workspace default team
 * (the v0 owns email config at the workspace level). Returns JSON-safe DTOs.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { ChannelAccountId, SendingDomainId, TeamId } from '@quackback/ids'
import type { ChannelAccount, EmailSendingDomain, SendingDomainDnsRecord } from '@/lib/server/db'
import { db, eq, teams } from '@/lib/server/db'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  getInboundRoute,
  listChannelAccounts,
  listSendingDomains,
  createInboundRoute,
  createSendingAddress,
  createSendingDomain,
  markSendingDomainVerified,
  softDeleteChannelAccount,
} from '@/lib/server/domains/channel-accounts/channel-account.service'

type DnsRecord = { type: string; host: string; value: string; purpose: string }

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
  dnsRecords: (d.dnsRecords ?? []) as DnsRecord[],
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
    return toAccount(
      await createInboundRoute({
        owningTeamId: teamId,
        config: { forwardingTarget: data.forwardingTarget, provider: 'resend' },
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
    const domain = data.domain.trim().toLowerCase()
    // The records the admin adds at their DNS provider, then verifies.
    const dnsRecords: SendingDomainDnsRecord[] = [
      { type: 'TXT', host: '@', value: 'v=spf1 include:_spf.resend.com ~all', purpose: 'spf' },
      {
        type: 'CNAME',
        host: 'resend._domainkey',
        value: 'resend._domainkey.resend.com',
        purpose: 'dkim',
      },
    ]
    return toDomain(await createSendingDomain({ owningTeamId: teamId, domain, dnsRecords }))
  })

export const verifySendingDomainFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.CHANNEL_ACCOUNT_MANAGE })
    // v0: mark verified on request (real DNS lookup is a follow-up).
    return toDomain(await markSendingDomainVerified(data.id as SendingDomainId))
  })

export const deleteChannelAccountFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.CHANNEL_ACCOUNT_MANAGE })
    await softDeleteChannelAccount(data.id as ChannelAccountId)
    return { id: data.id }
  })
