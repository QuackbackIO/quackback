/**
 * Default off is today's behaviour, demonstrated rather than asserted.
 *
 * The claim being defended: an install with no billing provider configured —
 * every self-hosted install, and every deployment that has not opted in — is
 * indistinguishable from one where this module does not exist. Not "mostly
 * inert", not "inert unless you look": no plan, no gating, no metering, no
 * nav item, no provider call, and no query it would not have made anyway.
 *
 * Each case below drives the real entry point with the environment empty and
 * checks what it does, so a future change that starts *doing* something on an
 * unconfigured install fails here rather than in a self-hoster's logs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ENTITLEMENT_KEYS } from '@/lib/server/domains/settings/cloud/cloud.types'
import { isEntitled } from '@/lib/server/domains/settings/cloud/entitlements'
import { DISABLED_CLOUD_CONFIG } from '@/lib/server/domains/settings/cloud/cloud.types'
import {
  getBillingConfig,
  isBillingConfigured,
  resetBillingConfigCache,
} from '../billing.config'
import { getBillingOverview, reconcileBilling, startCheckout } from '../billing.service'
import { handleBillingWebhook } from '../webhook.service'
import { signWebhookPayload } from '../provider/signature'

const BILLING_ENV = [
  'BILLING_API_KEY',
  'BILLING_WEBHOOK_SECRET',
  'BILLING_PRICES',
  'BILLING_ALLOW_LIVE',
  'BILLING_RETURN_URL',
]

/**
 * The settings-nav half of this guarantee lives in
 * `components/admin/settings/__tests__/settings-nav-billing.test.ts`: lint
 * forbids `lib/` importing from `components/`, and the rule is right — but
 * the two files answer one question and should be read together.
 */

/**
 * Fails if any database or network call happens. The point of this file is
 * that an unconfigured install does *nothing*, and "nothing" includes not
 * querying.
 */
const forbidden = vi.fn(() => {
  throw new Error('an unconfigured install must not reach the database or the network')
})

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  get db() {
    return new Proxy({}, { get: () => forbidden })
  },
}))

beforeEach(() => {
  for (const key of BILLING_ENV) delete process.env[key]
  resetBillingConfigCache()
  forbidden.mockClear()
})

afterEach(() => {
  resetBillingConfigCache()
  vi.restoreAllMocks()
})

describe('an install with no billing provider configured', () => {
  it('reports billing as unconfigured', () => {
    expect(isBillingConfigured()).toBe(false)
    expect(getBillingConfig()).toBeNull()
  })

  it('renders no billing surface', async () => {
    expect(await getBillingOverview()).toBeNull()
    expect(forbidden).not.toHaveBeenCalled()
  })

  it('reconciles nothing', async () => {
    expect(await reconcileBilling()).toEqual({ reconciled: false, plan: null })
    expect(forbidden).not.toHaveBeenCalled()
  })

  it('cannot start a checkout', async () => {
    await expect(
      startCheckout({ plan: 'pro', actorEmail: null, returnPath: '/admin/settings/billing' })
    ).rejects.toThrow(/not configured/i)
    expect(forbidden).not.toHaveBeenCalled()
  })

  it('answers the webhook endpoint without consuming anything', async () => {
    const body = JSON.stringify({
      id: 'evt_x',
      type: 'customer.subscription.updated',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'sub_x' } },
    })
    // Signed with a plausible secret, so the refusal is about the feature
    // being off rather than about the signature failing.
    const signature = signWebhookPayload(body, 'whsec_anything', Math.floor(Date.now() / 1000))
    expect(await handleBillingWebhook(body, signature)).toEqual({
      status: 400,
      body: { error: 'billing_not_configured' },
    })
    expect(forbidden).not.toHaveBeenCalled()
  })

  it('grants every entitlement, including ones added later', () => {
    // Iterates the live catalogue rather than a copied list, so an
    // entitlement added next year is covered without anyone remembering.
    for (const key of ENTITLEMENT_KEYS) {
      expect({ key, granted: isEntitled(DISABLED_CLOUD_CONFIG, key) }).toEqual({
        key,
        granted: true,
      })
    }
  })

  it('is off when only some of the required configuration is present', () => {
    process.env.BILLING_API_KEY = 'sk_test_partial'
    resetBillingConfigCache()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(isBillingConfigured()).toBe(false)
  })
})
