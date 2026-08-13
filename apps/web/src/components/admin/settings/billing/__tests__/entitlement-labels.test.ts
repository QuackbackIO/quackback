/**
 * Every entitlement the plan surface can render has a label.
 *
 * The billing page renders `ENTITLEMENT_LABELS[key] ?? key`, and the fallback
 * is silent: an entitlement added to the catalogue without a label here shows
 * a customer the raw camelCase key next to their plan. Nothing else notices,
 * because `listEntitlements()` returns every key in the catalogue and the page
 * maps over whatever it is handed.
 *
 * Driven off the live `ENTITLEMENT_KEYS` rather than a copied list, so a key
 * added next year is covered without anyone remembering.
 */
import { describe, expect, it } from 'vitest'
import { ENTITLEMENT_KEYS } from '@/lib/server/domains/settings/cloud/cloud.types'
import { ENTITLEMENT_LABELS } from '../billing-settings'

describe('the plan surface labels every entitlement', () => {
  it('has a human label for each key in the catalogue', () => {
    const missing = ENTITLEMENT_KEYS.filter((key) => !ENTITLEMENT_LABELS[key])
    expect(missing).toEqual([])
  })

  it('carries no label for a key the catalogue no longer has', () => {
    // The other direction. A stale label is dead copy that survives a rename
    // and quietly stops matching anything.
    const stale = Object.keys(ENTITLEMENT_LABELS).filter(
      (key) => !(ENTITLEMENT_KEYS as string[]).includes(key)
    )
    expect(stale).toEqual([])
  })
})
