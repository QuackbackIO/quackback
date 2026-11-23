/** A host's registrable domain, shared by Import (same site) and settings (the portal's own domain). */

/** Second-level labels that sit under a two-letter country code as one public suffix (`co.uk`). */
const SECOND_LEVEL_SUFFIXES = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu', 'ltd', 'plc'])

/** The registrable domain, approximately: `shop.acme.co.uk` is `acme.co.uk`. */
export function registrableDomain(hostname: string): string {
  const labels = hostname.toLowerCase().replace(/\.$/, '').split('.')
  if (labels.length <= 2) return labels.join('.')
  const tld = labels[labels.length - 1]
  const second = labels[labels.length - 2]
  const take = tld.length === 2 && SECOND_LEVEL_SUFFIXES.has(second) ? 3 : 2
  return labels.slice(-take).join('.')
}
