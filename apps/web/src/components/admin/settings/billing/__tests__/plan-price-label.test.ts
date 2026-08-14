/**
 * The plan picker names a price.
 *
 * Track-2 bar: the upgrade surface must name the plan AND the price before
 * the customer reaches the provider's hosted checkout. The label is built
 * from provider display data (amount/currency/interval), never from a price
 * id — `no-client-leak.db.test.ts` polices that boundary.
 */
import { describe, expect, it } from 'vitest'
import { formatPlanPrice } from '../billing-settings'

describe('formatPlanPrice', () => {
  it('renders a monthly seat price with its currency symbol', () => {
    const label = formatPlanPrice({ amount: 3200, currency: 'usd', interval: 'month' })
    expect(label).toContain('$32')
    expect(label).toContain('/seat/mo')
  })

  it('renders a yearly interval', () => {
    expect(formatPlanPrice({ amount: 32000, currency: 'usd', interval: 'year' })).toContain(
      '/seat/yr'
    )
  })

  it('names the unit when the provider reports no interval', () => {
    expect(formatPlanPrice({ amount: 500, currency: 'usd', interval: null })).toContain(
      '/seat/unit'
    )
  })
})
