/**
 * What Import says when a site answered, but not with its own page: an error
 * or maintenance page or a queue, a bot check, or a country picker
 * (site/page-kind.ts tells them apart). Nothing is imported.
 */
import { ForbiddenError } from '@/lib/shared/errors'
import { mapBrandRead, type BrandRead } from '@/lib/shared/theme/brand-import'
import type { BrandReaderResult } from './readers'
import { READER_TOKEN } from './robots'
import { pickerCandidates } from './site/page-kind'

/** Why Import read no page of the site: what it was shown in the site's place. */
export type SiteNotReadReason = 'error' | 'bot' | 'picker'

const NOT_READ: Record<SiteNotReadReason, { code: string; said: string; next: string }> = {
  error: {
    code: 'SITE_ERROR_PAGE',
    said: 'showed an error page',
    next: 'Try again in a few minutes.',
  },
  bot: {
    code: 'SITE_BLOCKED',
    said: 'asked us to prove we’re human',
    next: `If it’s your site, allow our reader: ${READER_TOKEN}`,
  },
  picker: {
    code: 'SITE_PICKER',
    said: 'opened a country picker',
    next: 'Pick your site to import it.',
  },
}

/**
 * The site answered, but not with its own page: an error or maintenance page
 * or a queue, a bot check, or a country picker. Nothing was imported. The
 * reader never tries to get past any of them.
 */
export class SiteNotReadError extends ForbiddenError {
  constructor(
    readonly reason: SiteNotReadReason,
    readonly host: string,
    /** A picker's own addresses the person can import instead, at most three. */
    readonly candidates: string[] = []
  ) {
    const { code, said, next } = NOT_READ[reason]
    // A picker whose choices are not addresses: the person types their country's own.
    const then =
      reason === 'picker' && candidates.length === 0
        ? 'Enter the address of your country’s site.'
        : next
    super(code, `${host} ${said}. Nothing changed. ${then}`)
  }
}

/** Whether a read holds anything of the brand: a logo, an icon, a colour, a font or a shape of its own. */
export function brandLike(read: BrandRead): boolean {
  const draft = mapBrandRead(read)
  const missing = new Set(draft.missing)
  return (
    Boolean(read.logo || read.icon) ||
    !missing.has('colour') ||
    !missing.has('shape') ||
    (!missing.has('font') && draft.font.id !== 'system')
  )
}

/** Up to three addresses a picker offers: its country links, else its hreflang versions. */
export function pickerAddresses(
  pickers: Extract<BrandReaderResult, { failed: unknown }>[],
  siteUrl: string,
  languages: string[]
): string[] {
  for (const picker of pickers) {
    const offered = pickerCandidates(picker.links ?? [], picker.pageUrl ?? siteUrl, languages)
    if (offered.length > 0) return offered
  }
  const versions = pickers.flatMap((picker) => picker.localVersions ?? [])
  return [...new Set(versions.filter((v) => v.lang !== 'x-default').map((v) => v.url))].slice(0, 3)
}
