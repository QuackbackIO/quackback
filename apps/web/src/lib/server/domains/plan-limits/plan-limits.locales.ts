/**
 * Which help center languages the plan holds back after the grace.
 *
 * The cap counts the default language plus every additional one. The default
 * language and the earliest-added additional languages up to the cap stay
 * editable; the languages added after them are held. A held language keeps
 * serving its published pages at the same URLs. It cannot be edited, and
 * automatic translation into it stops. Removing it stays open, since that is
 * one way back under the cap.
 *
 * `locales.additional` is kept in the order languages were added (a new one is
 * appended), so its order is the order this reads.
 */
import { logger } from '@/lib/server/logger'
import { ForbiddenError } from '@/lib/shared/errors'
import { getHelpCenterConfig } from '@/lib/server/domains/settings/settings.service'
import { getPlanLimits } from './plan-limits.service'

const log = logger.child({ component: 'plan-limits' })

/** The additional languages past a cap that counts the default language as one. */
export function extraHelpCenterLocales(additional: readonly string[], cap: number): string[] {
  return additional.slice(Math.max(0, cap - 1))
}

/** The additional languages held now. Empty unless the cap is enforced. Fails open. */
export async function heldHelpCenterLocales(additional?: readonly string[]): Promise<string[]> {
  try {
    const view = await getPlanLimits()
    if (!view.enabled || view.phase !== 'enforced') return []
    const issue = view.issues.find((i) => i.key === 'maxHelpCenterLocales')
    if (!issue) return []
    const locales = additional ?? (await getHelpCenterConfig()).locales.additional
    return extraHelpCenterLocales(locales, issue.cap)
  } catch (err) {
    log.error({ err }, 'help center language plan check failed; failing open')
    return []
  }
}

export async function isHelpCenterLocaleHeld(locale: string): Promise<boolean> {
  return (await heldHelpCenterLocales()).includes(locale)
}

/** Refuse an edit in a held language. */
export async function assertHelpCenterLocaleEditable(locale: string): Promise<void> {
  if (!(await isHelpCenterLocaleHeld(locale))) return
  throw new ForbiddenError(
    'HC_LOCALE_HELD',
    "This language can't be edited on your current plan. Its published pages stay live."
  )
}
