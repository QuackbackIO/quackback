import type Stripe from 'stripe'
import { getStripe } from './stripe'

// ============================================================================
// Types
// ============================================================================

export interface InvoiceListItem {
  id: string
  number: string | null
  status: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void'
  amountDue: number
  amountPaid: number
  currency: string
  created: Date
  periodStart: Date
  periodEnd: Date
  pdfUrl: string | null
  hostedInvoiceUrl: string | null
}

export interface PaymentMethodInfo {
  id: string
  type: 'card' | 'other'
  card: {
    brand: string
    last4: string
    expMonth: number
    expYear: number
  } | null
  isDefault: boolean
}

// ============================================================================
// Invoice Operations
// ============================================================================

/**
 * Get recent invoices for a customer.
 * Returns the most recent invoices sorted by creation date.
 */
export async function getCustomerInvoices(
  customerId: string,
  limit: number = 5
): Promise<InvoiceListItem[]> {
  const stripe = getStripe()

  const invoices = await stripe.invoices.list({
    customer: customerId,
    limit,
  })

  return invoices.data.map((inv) => ({
    id: inv.id,
    number: inv.number,
    status: inv.status as InvoiceListItem['status'],
    amountDue: inv.amount_due,
    amountPaid: inv.amount_paid,
    currency: inv.currency,
    created: new Date(inv.created * 1000),
    periodStart: new Date(inv.period_start * 1000),
    periodEnd: new Date(inv.period_end * 1000),
    pdfUrl: inv.invoice_pdf ?? null,
    hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
  }))
}

// ============================================================================
// Payment Method Operations
// ============================================================================

/**
 * Get payment methods for a customer.
 * Returns all card payment methods with default status.
 */
export async function getCustomerPaymentMethods(customerId: string): Promise<PaymentMethodInfo[]> {
  const stripe = getStripe()

  // Get customer to find default payment method
  const customer = (await stripe.customers.retrieve(customerId)) as Stripe.Customer

  const defaultPaymentMethodId =
    typeof customer.invoice_settings?.default_payment_method === 'string'
      ? customer.invoice_settings.default_payment_method
      : (customer.invoice_settings?.default_payment_method?.id ?? null)

  // Get all card payment methods
  const paymentMethods = await stripe.paymentMethods.list({
    customer: customerId,
    type: 'card',
  })

  return paymentMethods.data.map((pm) => ({
    id: pm.id,
    type: pm.type === 'card' ? 'card' : 'other',
    card: pm.card
      ? {
          brand: pm.card.brand,
          last4: pm.card.last4,
          expMonth: pm.card.exp_month,
          expYear: pm.card.exp_year,
        }
      : null,
    isDefault: pm.id === defaultPaymentMethodId,
  }))
}

/**
 * Get the default payment method (primary card on file).
 * Returns the default payment method or the first available one.
 */
export async function getDefaultPaymentMethod(
  customerId: string
): Promise<PaymentMethodInfo | null> {
  const methods = await getCustomerPaymentMethods(customerId)
  return methods.find((m) => m.isDefault) || methods[0] || null
}
