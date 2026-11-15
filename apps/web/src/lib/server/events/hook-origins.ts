/**
 * Where each portal section is linked for one event. Kept apart from
 * hook-context.ts, which reads the database, so a builder that only formats
 * links stays pure.
 */
import type { HookContext } from './hook-context'
import { allOnPrimary, type SectionOrigins } from '@/lib/shared/section-links'

/** The context's section origins; every section on the primary origin when it has none. */
export function hookOrigins(
  context: Pick<HookContext, 'portalBaseUrl' | 'sectionOrigins'>
): SectionOrigins {
  return context.sectionOrigins ?? allOnPrimary(context.portalBaseUrl)
}
