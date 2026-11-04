/**
 * The rows the Domains settings page lists: each domain the workspace uses,
 * with only what the overview shows. Setup stays on the page that owns it.
 */
import {
  and,
  asc,
  channelAccounts,
  db,
  emailSendingDomains,
  eq,
  isNull,
  ssoVerifiedDomain,
} from '@/lib/server/db'
import { shownProofSource, type ShownProofSource } from '@/lib/shared/domain-proof'
import type { PermissionKey } from '@/lib/shared/permissions'
import { toAsciiDomain } from '@/lib/server/domains/channel-accounts/outbound-identity'
import { getProvenZones, provenZoneCovering, sendingRowProvesZone } from './proven-zones'

export interface SendingDomainSummary {
  id: string
  domain: string
  status: string
  verifiedAt: string | null
  autoCheckUntil: string | null
  /** The local parts of the addresses sending from it, as "help@". */
  localParts: string[]
  ownershipProven: boolean
}

export interface SignInDomainSummary {
  id: string
  name: string
  verified: boolean
  /**
   * Another proof that covers the domain, when one does, named only when the
   * viewer may see what proved it.
   */
  provenBy: ShownProofSource | null
}

function localPart(address: string): string | null {
  const at = address.lastIndexOf('@')
  return at > 0 ? `${address.slice(0, at).toLowerCase()}@` : null
}

function addressDomain(address: string): string {
  return toAsciiDomain(address.slice(address.lastIndexOf('@') + 1))
}

export async function listSendingDomainSummaries(): Promise<SendingDomainSummary[]> {
  const [domains, senders] = await Promise.all([
    db.select().from(emailSendingDomains).orderBy(asc(emailSendingDomains.domain)),
    db
      .select({
        address: channelAccounts.address,
        sendingDomainId: channelAccounts.sendingDomainId,
      })
      .from(channelAccounts)
      .where(and(eq(channelAccounts.role, 'sending'), isNull(channelAccounts.deletedAt))),
  ])
  return domains.map((d) => {
    const domain = toAsciiDomain(d.domain)
    const parts = new Set<string>()
    for (const s of senders) {
      if (!s.address) continue
      const linked = s.sendingDomainId
        ? s.sendingDomainId === d.id
        : addressDomain(s.address) === domain
      const part = linked ? localPart(s.address) : null
      if (part) parts.add(part)
    }
    return {
      id: d.id,
      domain: d.domain,
      status: d.status,
      verifiedAt: d.verifiedAt?.toISOString() ?? null,
      autoCheckUntil: d.autoCheckUntil?.toISOString() ?? null,
      localParts: [...parts].sort(),
      ownershipProven: sendingRowProvesZone(d),
    }
  })
}

/** The SSO domains, as a viewer holding `viewer` may see them. */
export async function listSignInDomainSummaries(
  viewer: readonly PermissionKey[]
): Promise<SignInDomainSummary[]> {
  const [rows, zones] = await Promise.all([
    db
      .select({
        id: ssoVerifiedDomain.id,
        name: ssoVerifiedDomain.name,
        verifiedAt: ssoVerifiedDomain.verifiedAt,
      })
      .from(ssoVerifiedDomain)
      .orderBy(asc(ssoVerifiedDomain.name)),
    getProvenZones(),
  ])
  return rows.map((r) => {
    const covering = provenZoneCovering(r.name, zones)
    return {
      id: r.id,
      name: r.name,
      verified: r.verifiedAt !== null,
      provenBy: covering ? shownProofSource(covering.source, viewer) : null,
    }
  })
}
