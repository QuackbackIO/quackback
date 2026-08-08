/**
 * No billing reference reaches the client.
 *
 * Two independent surfaces could leak one, and both are checked against a
 * workspace that genuinely has a subscription — a test on an unconfigured
 * install would pass because there is nothing to leak:
 *
 *  1. **The settings payload.** `settings.cloud` holds `customerRef` and
 *     `subscriptionRef`. It is in `SERVER_ONLY_SETTINGS_KEYS`, and this asserts
 *     the redaction actually removes it from a fully-populated row rather than
 *     trusting the list.
 *  2. **The billing page payload.** `getBillingOverview()` is client-bound by
 *     construction, so its shape is the thing to police. It may carry an
 *     invoice id and a hosted invoice link — the customer clicks those — but
 *     it must never carry the provider customer or subscription reference, a
 *     price id, the API key or the webhook secret.
 *
 * The assertion is a search for the actual secret *values* through the whole
 * serialized payload, not a check that particular field names are absent: a
 * leak nested inside an object the shape does not name would pass the latter.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { settings } from '@/lib/server/db'
import { redactSettingsForClient } from '@/lib/shared/redact-portal-config'
import type { BillingProviderClient } from '../provider/client'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/domains/settings/settings.helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/settings/settings.helpers')>()),
  invalidateSettingsCache: vi.fn(async () => {}),
}))

vi.mock('@/lib/server/domains/settings/settings.service', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/server/domains/settings/settings.service')>()
  return {
    ...actual,
    getTenantSettings: async () => {
      const db = (await import('@/lib/server/__tests__/db-test-fixture')).testDb
      const row = await db.query.settings.findFirst()
      return row ? { settings: row } : null
    },
  }
})

const providerClient = vi.hoisted(() => ({ value: null as BillingProviderClient | null }))
vi.mock('../provider/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../provider/client')>()),
  makeProviderClient: () => providerClient.value,
}))

const { getBillingOverview } = await import('../billing.service')
const { applySubscription, toSnapshot } = await import('../subscription')
const { getBillingConfig, resetBillingConfigCache } = await import('../billing.config')

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ cloud: settings.cloud, revision: settings.cloudRevision }).from(settings).limit(0)
  },
})

/** Values that must never appear anywhere in a client-bound payload. */
const SECRETS = {
  apiKey: 'sk_test_leakcheck_apikey',
  webhookSecret: 'whsec_leakcheck_secret',
  customerRef: 'cus_leakcheck',
  subscriptionRef: 'sub_leakcheck',
  seatPrice: 'price_leakcheck_seat',
  outcomePrice: 'price_leakcheck_outcome',
}

const CATALOGUE = {
  free: { seat: 'price_leakcheck_free' },
  pro: {
    seat: SECRETS.seatPrice,
    outcome: SECRETS.outcomePrice,
    outcomeMeter: 'meter_leakcheck',
    limits: { maxBoards: 25 },
  },
}

function stub(): BillingProviderClient {
  return {
    getSubscription: vi.fn(async (id: string) => ({
      id,
      customer: SECRETS.customerRef,
      status: 'active',
      current_period_end: 1_774_915_200,
      items: { data: [{ id: 'si_1', quantity: 3, price: { id: SECRETS.seatPrice } }] },
    })),
    listInvoices: vi.fn(async () => [
      {
        id: 'in_leakcheck',
        number: 'ACME-0001',
        status: 'paid',
        total: 2500,
        currency: 'usd',
        created: 1_772_000_000,
        hosted_invoice_url: 'https://pay.example.test/invoice/in_leakcheck',
        invoice_pdf: 'https://pay.example.test/invoice/in_leakcheck.pdf',
      },
    ]),
    listPaymentMethods: vi.fn(async () => [
      { id: 'pm_1', type: 'card', card: { brand: 'visa', last4: '4242', exp_month: 4, exp_year: 2030 } },
    ]),
    updateSubscriptionItems: vi.fn(),
    reportMeterEvent: vi.fn(),
    createCustomer: vi.fn(),
    getCustomer: vi.fn(),
    createCheckoutSession: vi.fn(),
    createPortalSession: vi.fn(),
  } as unknown as BillingProviderClient
}

/** Every string anywhere in a value, at any depth. */
function allStrings(value: unknown, acc: string[] = []): string[] {
  if (typeof value === 'string') acc.push(value)
  else if (Array.isArray(value)) value.forEach((v) => allStrings(v, acc))
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      acc.push(k)
      allStrings(v, acc)
    }
  }
  return acc
}

function leaks(payload: unknown, forbidden: string[]): string[] {
  const haystack = allStrings(payload)
  return forbidden.filter((needle) => haystack.some((s) => s.includes(needle)))
}

beforeEach(async () => {
  await fixture.begin()
  await testDb.insert(settings).values({
    name: 'Leak Check',
    slug: `leak-check-${createId('workspace')}`,
    createdAt: new Date(),
  })
  process.env.BILLING_API_KEY = SECRETS.apiKey
  process.env.BILLING_WEBHOOK_SECRET = SECRETS.webhookSecret
  process.env.BILLING_PRICES = JSON.stringify(CATALOGUE)
  resetBillingConfigCache()
  providerClient.value = stub()

  // Give the workspace a real subscription, so there IS something to leak.
  const config = getBillingConfig()!
  await applySubscription(
    toSnapshot(
      {
        id: SECRETS.subscriptionRef,
        customer: SECRETS.customerRef,
        status: 'active',
        current_period_end: 1_774_915_200,
        items: { data: [{ id: 'si_1', quantity: 3, price: { id: SECRETS.seatPrice } }] },
      },
      config,
      new Date()
    ),
    config
  )
})

afterEach(async () => {
  await fixture.rollback()
  delete process.env.BILLING_API_KEY
  delete process.env.BILLING_WEBHOOK_SECRET
  delete process.env.BILLING_PRICES
  resetBillingConfigCache()
  providerClient.value = null
  vi.clearAllMocks()
})

afterAll(async () => {
  await fixture.close()
})

describe.skipIf(!fixture.available)('billing references never reach the client', () => {
  it('stores the references it is supposed to, so the checks below are not vacuous', async () => {
    // The precondition. Without it, every assertion in this file would pass
    // on an empty column and prove nothing.
    const row = await testDb.query.settings.findFirst()
    expect(row?.cloud).toMatchObject({
      plan: 'pro',
      billing: {
        customerRef: SECRETS.customerRef,
        subscriptionRef: SECRETS.subscriptionRef,
      },
    })
  })

  it('strips the whole cloud block from the client settings payload', async () => {
    const row = await testDb.query.settings.findFirst()
    const tenant = { ...row, settings: row } as unknown as Record<string, unknown>

    const redacted = redactSettingsForClient(tenant as never)
    expect(leaks(redacted, [SECRETS.customerRef, SECRETS.subscriptionRef])).toEqual([])
    // And the key itself is gone, at both levels the redactor walks.
    expect(redacted).not.toHaveProperty('cloud')
    expect((redacted as { settings?: Record<string, unknown> }).settings).not.toHaveProperty('cloud')
  })

  it('keeps provider identifiers and credentials out of the billing page payload', async () => {
    const overview = await getBillingOverview()
    expect(overview).not.toBeNull()

    expect(
      leaks(overview, [
        SECRETS.apiKey,
        SECRETS.webhookSecret,
        SECRETS.customerRef,
        SECRETS.subscriptionRef,
        SECRETS.seatPrice,
        SECRETS.outcomePrice,
        'price_leakcheck_free',
      ])
    ).toEqual([])
  })

  it('still carries what the page legitimately needs', async () => {
    // The inverse assertion, so "leaks nothing" cannot be satisfied by
    // returning nothing.
    const overview = (await getBillingOverview())!
    expect(overview).toMatchObject({
      plan: 'pro',
      planName: 'Pro',
      status: 'active',
      hasSubscription: true,
      livemode: false,
      paymentMethod: { brand: 'visa', last4: '4242', expMonth: 4, expYear: 2030 },
    })
    expect(overview.invoices).toEqual([
      {
        id: 'in_leakcheck',
        number: 'ACME-0001',
        status: 'paid',
        total: 2500,
        currency: 'usd',
        createdAt: new Date(1_772_000_000 * 1000).toISOString(),
        hostedUrl: 'https://pay.example.test/invoice/in_leakcheck',
        pdfUrl: 'https://pay.example.test/invoice/in_leakcheck.pdf',
      },
    ])
    // Only the plans this deployment actually sells, and by name — never by
    // price id.
    expect(overview.purchasablePlans.map((p) => p.id)).toEqual(['free', 'pro'])
  })
})
