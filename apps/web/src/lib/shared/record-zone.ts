/**
 * The zone a sending domain's records are typed into, and a record's name as
 * that zone's form expects it.
 *
 * A record's host is stored relative to the sending domain. When that domain is
 * a name inside a parent's zone (`updates.acme.com` in `acme.com`), the form
 * appends the zone, so the name to type carries the labels between the two.
 */

/** The zone found at setup when it holds the domain, else the domain itself. */
export function recordZone(domain: string, zone: string | undefined): string {
  const found = zone?.trim().toLowerCase().replace(/\.$/, '')
  return found && (domain === found || domain.endsWith(`.${found}`)) ? found : domain
}

/** A host relative to the domain, as a name relative to the domain's zone. */
export function nameInZone(host: string, domain: string, zone: string | undefined): string {
  const within = recordZone(domain, zone)
  if (within === domain) return host
  const between = domain.slice(0, -(within.length + 1))
  return host === '@' ? between : `${host}.${between}`
}
