/**
 * Configuration resolution — the switch behind the default-off guarantee.
 *
 * The cases that matter are the negative ones: every path that must produce
 * `null`, because `null` is what makes the whole module inert.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BILLING_PROVIDER,
  getBillingConfig,
  isBillingConfigured,
  meterForPrice,
  planForPrice,
  resetBillingConfigCache,
  type BillingCatalogue,
} from '../billing.config'

const CATALOGUE = {
  pro: {
    seat: 'price_pro_seat',
    liteSeat: 'price_pro_lite',
    copilotSeat: 'price_pro_copilot',
    outcome: 'price_pro_outcome',
    outcomeMeter: 'quackback_resolved_outcome',
    limits: { maxBoards: 25, aiTokensPerMonth: 1_000_000 },
  },
  business: { seat: 'price_biz_seat' },
}

const KEYS = ['BILLING_API_KEY', 'BILLING_WEBHOOK_SECRET', 'BILLING_PRICES', 'BILLING_ALLOW_LIVE']

function setEnv(values: Record<string, string | undefined>) {
  for (const key of KEYS) delete process.env[key]
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = value
  }
  resetBillingConfigCache()
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  setEnv({})
  vi.restoreAllMocks()
})

describe('getBillingConfig', () => {
  it('is null when nothing is configured', () => {
    setEnv({})
    expect(getBillingConfig()).toBeNull()
    expect(isBillingConfigured()).toBe(false)
  })

  it('resolves a complete test-mode configuration', () => {
    setEnv({
      BILLING_API_KEY: 'sk_test_abc',
      BILLING_WEBHOOK_SECRET: 'whsec_abc',
      BILLING_PRICES: JSON.stringify(CATALOGUE),
    })
    const config = getBillingConfig()
    expect(config).not.toBeNull()
    expect(config!.livemode).toBe(false)
    expect(config!.provider).toBe(BILLING_PROVIDER)
    expect(config!.catalogue).toEqual(CATALOGUE)
  })

  it.each([
    ['no api key', { BILLING_WEBHOOK_SECRET: 'whsec_abc', BILLING_PRICES: '{}' }],
    ['no webhook secret', { BILLING_API_KEY: 'sk_test_abc', BILLING_PRICES: '{}' }],
    ['no catalogue', { BILLING_API_KEY: 'sk_test_abc', BILLING_WEBHOOK_SECRET: 'whsec_abc' }],
  ])('stays off with %s', (_label, env) => {
    setEnv(env)
    expect(getBillingConfig()).toBeNull()
  })

  it('stays off when the catalogue is not valid JSON', () => {
    setEnv({
      BILLING_API_KEY: 'sk_test_abc',
      BILLING_WEBHOOK_SECRET: 'whsec_abc',
      BILLING_PRICES: '{not json',
    })
    expect(getBillingConfig()).toBeNull()
  })

  it('stays off when the catalogue names a plan the product does not model', () => {
    setEnv({
      BILLING_API_KEY: 'sk_test_abc',
      BILLING_WEBHOOK_SECRET: 'whsec_abc',
      BILLING_PRICES: JSON.stringify({ platinum: { seat: 'price_x' } }),
    })
    expect(getBillingConfig()).toBeNull()
  })

  it('stays off when a plan declares a metered price with no meter name', () => {
    // Usage is reported against the meter, not the price. A catalogue that
    // sells outcomes but names no meter would silently never bill for them.
    setEnv({
      BILLING_API_KEY: 'sk_test_abc',
      BILLING_WEBHOOK_SECRET: 'whsec_abc',
      BILLING_PRICES: JSON.stringify({ pro: { seat: 'price_a', outcome: 'price_b' } }),
    })
    expect(getBillingConfig()).toBeNull()
  })

  it('stays off when the catalogue declares no plans at all', () => {
    setEnv({
      BILLING_API_KEY: 'sk_test_abc',
      BILLING_WEBHOOK_SECRET: 'whsec_abc',
      BILLING_PRICES: '{}',
    })
    expect(getBillingConfig()).toBeNull()
  })

  it('refuses a live-mode key without an explicit opt-in', () => {
    // The incident this prevents: a staging environment inheriting the
    // production key and charging real customers from synthetic data.
    setEnv({
      BILLING_API_KEY: 'sk_live_abc',
      BILLING_WEBHOOK_SECRET: 'whsec_abc',
      BILLING_PRICES: JSON.stringify(CATALOGUE),
    })
    expect(getBillingConfig()).toBeNull()
  })

  it('accepts a live-mode key when the opt-in is present', () => {
    setEnv({
      BILLING_API_KEY: 'sk_live_abc',
      BILLING_WEBHOOK_SECRET: 'whsec_abc',
      BILLING_PRICES: JSON.stringify(CATALOGUE),
      BILLING_ALLOW_LIVE: 'true',
    })
    expect(getBillingConfig()?.livemode).toBe(true)
  })

  it('treats an unrecognised key prefix as live', () => {
    // Unrecognised must fail towards caution: assuming test mode for a key
    // that is actually live is the expensive direction of the mistake.
    setEnv({
      BILLING_API_KEY: 'mystery_key',
      BILLING_WEBHOOK_SECRET: 'whsec_abc',
      BILLING_PRICES: JSON.stringify(CATALOGUE),
    })
    expect(getBillingConfig()).toBeNull()
  })

  it('accepts a restricted test key', () => {
    setEnv({
      BILLING_API_KEY: 'rk_test_abc',
      BILLING_WEBHOOK_SECRET: 'whsec_abc',
      BILLING_PRICES: JSON.stringify(CATALOGUE),
    })
    expect(getBillingConfig()?.livemode).toBe(false)
  })
})

describe('price lookup', () => {
  const catalogue = CATALOGUE as BillingCatalogue

  it('resolves each price to its plan', () => {
    expect(planForPrice(catalogue, 'price_pro_seat')).toBe('pro')
    expect(planForPrice(catalogue, 'price_pro_outcome')).toBe('pro')
    expect(planForPrice(catalogue, 'price_biz_seat')).toBe('business')
    expect(planForPrice(catalogue, 'price_unknown')).toBeNull()
  })

  it('resolves each price to its meter', () => {
    const pro = catalogue.pro!
    expect(meterForPrice(pro, 'price_pro_seat')).toBe('fullSeat')
    expect(meterForPrice(pro, 'price_pro_lite')).toBe('liteSeat')
    expect(meterForPrice(pro, 'price_pro_copilot')).toBe('copilotSeat')
    expect(meterForPrice(pro, 'price_pro_outcome')).toBe('resolvedOutcome')
    expect(meterForPrice(pro, 'price_biz_seat')).toBeNull()
  })
})
