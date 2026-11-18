/**
 * The quiet next step beside an address that cannot send as itself because
 * its domain is not Verified: Verify domain, to that domain on Settings >
 * Domains when it is there, else to Add domain. An address whose domain is
 * Verified but whose sending records are not in yet gets none: its setup panel
 * is the next step.
 *
 * The domains are read only when some address cannot send, and only for a
 * viewer who may add and verify a domain, so a page with every address
 * sending reads nothing more.
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { addedDomainsQuery } from '@/lib/client/queries/channel-accounts'
import { addDomainLink } from '@/lib/shared/domains-permissions'

export type VerifyDomainTarget =
  | { to: '/admin/settings/domains/$domain'; params: { domain: string } }
  | ReturnType<typeof addDomainLink>

/**
 * The closest of `names` a domain is at or under, the rule Settings > Domains
 * reads coverage by (`coveringName`, kept out of this page's chunks).
 */
function closestCovering(domain: string, names: readonly string[]): string | null {
  let best: string | null = null
  for (const name of names) {
    if ((domain === name || domain.endsWith(`.${name}`)) && name.length > (best?.length ?? 0)) {
      best = name
    }
  }
  return best
}

/** The domain of an address, lower-cased, or null without one. */
const domainOfAddress = (address: string): string | null => {
  const at = address.lastIndexOf('@')
  const domain =
    at >= 0
      ? address
          .slice(at + 1)
          .trim()
          .toLowerCase()
      : ''
  return domain || null
}

/**
 * Where Verify domain goes for each address that cannot send, by address.
 * Null for one that can, one whose domain is Verified, or until the domains
 * are read.
 */
export function useVerifyDomainLinks(
  addresses: readonly { address: string | null; sendable?: boolean }[],
  canAddDomain: boolean
): (address: string | null | undefined) => VerifyDomainTarget | null {
  const waiting = new Set(
    addresses.filter((a) => a.address && a.sendable === false).map((a) => a.address as string)
  )
  const { data } = useQuery({
    ...addedDomainsQuery(),
    enabled: canAddDomain && waiting.size > 0,
  })
  return (address) => {
    if (!address || !waiting.has(address) || !data) return null
    const domain = domainOfAddress(address)
    if (!domain) return null
    const verified = data.filter((d) => d.verified).map((d) => d.name)
    if (closestCovering(domain, verified)) return null
    const added = closestCovering(
      domain,
      data.map((d) => d.name)
    )
    return added
      ? { to: '/admin/settings/domains/$domain', params: { domain: added } }
      : addDomainLink()
  }
}

/** Verify domain, as a quiet button at a row's end. */
export function VerifyDomainLink({ target }: { target: VerifyDomainTarget }) {
  return (
    <Button size="sm" variant="ghost" asChild>
      <Link {...target}>Verify domain</Link>
    </Button>
  )
}
