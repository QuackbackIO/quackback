/**
 * A thin, typed client over the billing provider's REST API.
 *
 * No SDK dependency. The repo already talks to this provider over plain
 * `fetch` from the customer-data enrichment integration under
 * `apps/web/src/integrations/`, the surface needed here is nine endpoints,
 * and an SDK would add a large dependency whose main value — exhaustive types
 * for an API we use a sliver of — we get more cheaply by declaring the
 * sliver.
 *
 * Everything is form-encoded, because that is what the API accepts, including
 * the bracketed array syntax for subscription items.
 */

import { logger } from '@/lib/server/logger'
import type { BillingConfig } from '../billing.config'

const log = logger.child({ component: 'billing-provider' })

// Wire constant: the provider's API host, fixed by the protocol.
const API_ROOT = 'https://api.stripe.com/v1'

/** Raised for any non-2xx. Carries enough to decide whether to retry. */
export class BillingProviderError extends Error {
  readonly status: number
  readonly providerCode: string | null
  readonly requestId: string | null

  constructor(
    status: number,
    message: string,
    providerCode: string | null,
    requestId: string | null
  ) {
    super(message)
    this.name = 'BillingProviderError'
    this.status = status
    this.providerCode = providerCode
    this.requestId = requestId
  }

  /**
   * Whether a retry could plausibly succeed. 409 is included because the
   * provider uses it for concurrent-modification on the same object.
   */
  get retryable(): boolean {
    return this.status === 429 || this.status === 409 || this.status >= 500
  }
}

// ---------------------------------------------------------------------------
// Response shapes — only the fields this module reads
// ---------------------------------------------------------------------------

export interface ProviderCustomer {
  id: string
  email: string | null
  /**
   * Provider-side key/value bag. Carries the workspace stamp this module
   * writes at creation, which is what lets an adoption decision be verified
   * against the provider rather than assumed.
   */
  metadata?: Record<string, string> | null
  /** Provider-side default payment method, when the API expanded one. */
  invoice_settings?: { default_payment_method?: string | null } | null
}

export interface ProviderSubscriptionItem {
  id: string
  quantity?: number | null
  price: { id: string; recurring?: { usage_type?: string | null } | null }
}

export interface ProviderSubscription {
  id: string
  customer: string
  status: string
  cancel_at_period_end?: boolean
  current_period_end?: number | null
  items: { data: ProviderSubscriptionItem[] }
}

export interface ProviderInvoice {
  id: string
  number: string | null
  status: string | null
  total: number
  currency: string
  created: number
  hosted_invoice_url: string | null
  invoice_pdf: string | null
}

export interface ProviderPaymentMethod {
  id: string
  type: string
  card?: { brand: string; last4: string; exp_month: number; exp_year: number } | null
}

export interface ProviderSession {
  id: string
  url: string | null
}

export interface ProviderPrice {
  id: string
  /** Minor units (cents for USD). null for tiered/volume prices. */
  unit_amount: number | null
  currency: string
  recurring: { interval: string } | null
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface BillingProviderClient {
  createCustomer(input: {
    email?: string
    name?: string
    metadata?: Record<string, string>
  }): Promise<ProviderCustomer>
  getCustomer(id: string): Promise<ProviderCustomer>
  createCheckoutSession(input: CheckoutInput): Promise<ProviderSession>
  createPortalSession(input: { customer: string; returnUrl: string }): Promise<ProviderSession>
  getSubscription(id: string): Promise<ProviderSubscription>
  /** Read one price, for displaying what a plan costs. Never sent client-side as an id. */
  getPrice(id: string): Promise<ProviderPrice>
  updateSubscriptionItems(
    id: string,
    items: Array<{ id?: string; price?: string; quantity?: number; deleted?: boolean }>,
    idempotencyKey: string
  ): Promise<ProviderSubscription>
  listInvoices(customer: string, limit: number): Promise<ProviderInvoice[]>
  listPaymentMethods(customer: string): Promise<ProviderPaymentMethod[]>
  reportMeterEvent(input: {
    meter: string
    customer: string
    value: number
    /** Provider-side dedupe key. The same identifier is counted once. */
    identifier: string
    timestamp: number
  }): Promise<void>
}

export interface CheckoutInput {
  customer: string
  successUrl: string
  cancelUrl: string
  lineItems: Array<{ price: string; quantity?: number }>
  /** Echoed back on the completed-session webhook. */
  metadata?: Record<string, string>
  idempotencyKey: string
}

export function makeProviderClient(config: BillingConfig): BillingProviderClient {
  async function call<T>(
    path: string,
    init: { method: 'GET' | 'POST'; form?: FormPairs; idempotencyKey?: string }
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${config.apiKey}`,
    }
    let url = `${API_ROOT}${path}`
    let body: string | undefined
    if (init.method === 'POST') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
      body = encodeForm(init.form ?? [])
    } else if (init.form && init.form.length > 0) {
      url += `?${encodeForm(init.form)}`
    }
    if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey

    const response = await fetch(url, { method: init.method, headers, body })
    const requestId = response.headers.get('request-id')
    const text = await response.text()

    if (!response.ok) {
      const parsed = safeJson(text) as { error?: { message?: string; code?: string } } | null
      const message = parsed?.error?.message ?? `provider returned ${response.status}`
      log.warn(
        { status: response.status, path, requestId, providerCode: parsed?.error?.code },
        'billing provider call failed'
      )
      throw new BillingProviderError(
        response.status,
        message,
        parsed?.error?.code ?? null,
        requestId
      )
    }
    return (safeJson(text) ?? {}) as T
  }

  return {
    createCustomer: (input) =>
      call<ProviderCustomer>('/customers', {
        method: 'POST',
        form: [
          ...optional('email', input.email),
          ...optional('name', input.name),
          ...Object.entries(input.metadata ?? {}).map(
            ([k, v]) => [`metadata[${k}]`, v] as FormPair
          ),
        ],
      }),

    getCustomer: (id) =>
      call<ProviderCustomer>(`/customers/${encodeURIComponent(id)}`, { method: 'GET' }),

    createCheckoutSession: (input) =>
      call<ProviderSession>('/checkout/sessions', {
        method: 'POST',
        idempotencyKey: input.idempotencyKey,
        form: [
          ['mode', 'subscription'],
          ['customer', input.customer],
          ['success_url', input.successUrl],
          ['cancel_url', input.cancelUrl],
          ...input.lineItems.flatMap((item, i): FormPairs => {
            const pairs: FormPairs = [[`line_items[${i}][price]`, item.price]]
            // A metered line item must NOT carry a quantity; the provider
            // rejects the session outright if it does.
            if (item.quantity !== undefined) {
              pairs.push([`line_items[${i}][quantity]`, String(item.quantity)])
            }
            return pairs
          }),
          ...Object.entries(input.metadata ?? {}).map(
            ([k, v]) => [`metadata[${k}]`, v] as FormPair
          ),
        ],
      }),

    createPortalSession: (input) =>
      call<ProviderSession>('/billing_portal/sessions', {
        method: 'POST',
        form: [
          ['customer', input.customer],
          ['return_url', input.returnUrl],
        ],
      }),

    getSubscription: (id) =>
      call<ProviderSubscription>(`/subscriptions/${encodeURIComponent(id)}`, { method: 'GET' }),

    getPrice: (id) => call<ProviderPrice>(`/prices/${encodeURIComponent(id)}`, { method: 'GET' }),

    updateSubscriptionItems: (id, items, idempotencyKey) =>
      call<ProviderSubscription>(`/subscriptions/${encodeURIComponent(id)}`, {
        method: 'POST',
        idempotencyKey,
        form: items.flatMap((item, i): FormPairs => {
          const pairs: FormPairs = []
          if (item.id) pairs.push([`items[${i}][id]`, item.id])
          if (item.price) pairs.push([`items[${i}][price]`, item.price])
          if (item.quantity !== undefined)
            pairs.push([`items[${i}][quantity]`, String(item.quantity)])
          if (item.deleted) pairs.push([`items[${i}][deleted]`, 'true'])
          return pairs
        }),
      }),

    listInvoices: async (customer, limit) => {
      const result = await call<{ data: ProviderInvoice[] }>('/invoices', {
        method: 'GET',
        form: [
          ['customer', customer],
          ['limit', String(limit)],
        ],
      })
      return result.data ?? []
    },

    listPaymentMethods: async (customer) => {
      const result = await call<{ data: ProviderPaymentMethod[] }>('/payment_methods', {
        method: 'GET',
        form: [
          ['customer', customer],
          ['type', 'card'],
        ],
      })
      return result.data ?? []
    },

    reportMeterEvent: async (input) => {
      await call<unknown>('/billing/meter_events', {
        method: 'POST',
        form: [
          ['event_name', input.meter],
          ['identifier', input.identifier],
          ['timestamp', String(input.timestamp)],
          // Wire field name, defined by the provider's meter-event schema.
          ['payload[stripe_customer_id]', input.customer],
          ['payload[value]', String(input.value)],
        ],
      })
    },
  }
}

// ---------------------------------------------------------------------------
// Form encoding
// ---------------------------------------------------------------------------

type FormPair = [string, string]
type FormPairs = FormPair[]

function optional(key: string, value: string | undefined): FormPairs {
  return value === undefined ? [] : [[key, value]]
}

function encodeForm(pairs: FormPairs): string {
  return pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
}

function safeJson(text: string): unknown {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
