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
import { INLINE_LINK } from '@/components/admin/settings/inline-link'
import { addedDomainsQuery } from '@/lib/client/queries/domains'
import { addDomainLink } from '@/lib/shared/domains-permissions'
import { coveringName } from '@/lib/shared/custom-domains'

export type VerifyDomainTarget =
  | { to: '/admin/settings/domains/$domain'; params: { domain: string } }
  | ReturnType<typeof addDomainLink>

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
    if (coveringName(domain, verified)) return null
    const added = coveringName(
      domain,
      data.map((d) => d.name)
    )
    return added
      ? { to: '/admin/settings/domains/$domain', params: { domain: added } }
      : addDomainLink()
  }
}

/** Verify domain: a quiet button at a row's end, or a link inside a line of text. */
export function VerifyDomainLink({
  target,
  inline = false,
}: {
  target: VerifyDomainTarget
  inline?: boolean
}) {
  if (inline) {
    return (
      <Link {...target} className={INLINE_LINK}>
        Verify domain
      </Link>
    )
  }
  return (
    <Button size="sm" variant="ghost" asChild>
      <Link {...target}>Verify domain</Link>
    </Button>
  )
}
