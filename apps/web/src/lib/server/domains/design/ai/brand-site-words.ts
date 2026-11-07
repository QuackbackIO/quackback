/**
 * What a brand's site says in words, for a match: the name it gives itself.
 */
import type { SiteFacts, SiteRead } from '../site/types'

const bare = (name: string) =>
  name
    .toLowerCase()
    .replace(/\b(variable|var|vf|web)\b/g, '')
    .replace(/[^a-z0-9]/g, '')

// ---------------------------------------------------------------- words

/** A domain ending a name (`Acme.com`), which the name does without. */
const TLD = /\.(com|net|org|io|co|so|app|ai|dev|uk|co\.uk)$/i

/** The host's own label: `acme` for www.acme.co.uk. */
function hostLabel(url: string): string {
  try {
    const parts = new URL(url).hostname.replace(/^www\./, '').split('.')
    const second = parts.at(-2) ?? ''
    return (
      ['co', 'com', 'org', 'net', 'ac'].includes(second) && parts.length > 2
        ? parts.at(-3)!
        : second
    ).toLowerCase()
  } catch {
    return ''
  }
}

/**
 * The brand's name as its site gives it, when the site says it plainly: of a
 * name with a tagline (`Acme | Parcels across town`), the part that is the
 * site's own host; a name from the page title only when a part of it is.
 */
export function siteName(facts: SiteFacts | null | undefined): string | null {
  const name = facts?.name?.trim()
  if (!name) return null
  const label = hostLabel(facts!.url)
  const parts = name
    .split(/\s+[|\u2013\u2014:\u00b7-]\s+/)
    .map((p) => p.trim().replace(TLD, ''))
    .filter(Boolean)
  const own = parts.find((p) => bare(p) === label || bare(p) === label.replace(/\d+$/, ''))
  if (own) return own.slice(0, 60)
  // A site name given as one plain part is the name, whatever its host.
  if (facts!.nameFrom !== 'title' && parts.length === 1 && parts[0]!.length <= 40)
    return parts[0]!.slice(0, 60)
  return null
}

/** Whether a site read is worth using at all. */
export const usable = (
  read: SiteRead | null | undefined
): read is SiteRead & { facts: SiteFacts } => !!read?.facts && read.failed !== 'challenge'
