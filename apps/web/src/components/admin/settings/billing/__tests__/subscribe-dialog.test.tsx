// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SubscribeDialog } from '../subscribe-dialog'

const plan = {
  id: 'pro' as const,
  name: 'Pro',
  rank: 2,
  priceMonthlyCents: 3000,
  priceYearlyCents: 28800,
  billedPer: 'seat' as const,
  bestFor: 'Teams',
  highlights: [],
  recommended: true,
}

describe('SubscribeDialog', () => {
  it('floors seats at current usage and shows catalogue due-today', () => {
    render(
      <SubscribeDialog
        open
        onOpenChange={() => {}}
        plan={plan}
        endsTrial
        minSeats={3}
        discountMonths={2}
        period="annual"
      />
    )
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByLabelText('Fewer seats')).toBeDisabled()
    expect(screen.getByText(/Due today/)).toBeInTheDocument()
    expect(screen.getByText('$864.00')).toBeInTheDocument()
    expect(screen.getByText(/Billing starts today and your trial ends/)).toBeInTheDocument()
    expect(screen.queryByText(/checkout page/)).not.toBeInTheDocument()
    const form = document.querySelector('form')
    expect(form?.querySelector('input[name="quantity"]')).toHaveValue('3')
    expect(form?.querySelector('input[name="billingPeriod"]')).toHaveValue('annual')
  })

  it('drops the trial sentence for Free-to-paid', () => {
    render(
      <SubscribeDialog
        open
        onOpenChange={() => {}}
        plan={plan}
        endsTrial={false}
        minSeats={1}
        discountMonths={2}
        period="annual"
      />
    )
    expect(screen.queryByText(/your trial ends/)).not.toBeInTheDocument()
    expect(screen.getByText(/Payment is handled by Stripe/)).toBeInTheDocument()
    expect(screen.queryByText(/checkout page/)).not.toBeInTheDocument()
  })

  it('switches due-today to monthly stickers', () => {
    render(
      <SubscribeDialog
        open
        onOpenChange={() => {}}
        plan={plan}
        endsTrial
        minSeats={2}
        discountMonths={2}
        period="annual"
      />
    )
    fireEvent.click(screen.getByRole('radio', { name: 'Monthly' }))
    expect(screen.getByText('$60.00')).toBeInTheDocument()
  })

  it('opens on the period selected on the plans page', () => {
    render(
      <SubscribeDialog
        open
        onOpenChange={() => {}}
        plan={plan}
        endsTrial
        minSeats={2}
        discountMonths={2}
        period="monthly"
      />
    )
    expect(screen.getByRole('radio', { name: 'Monthly' })).toHaveAttribute('aria-checked', 'true')
    expect(document.querySelector('input[name="billingPeriod"]')).toHaveValue('monthly')
    expect(screen.getByText('$60.00')).toBeInTheDocument()
  })

  it('does not multiply a workspace price by seat usage', () => {
    render(
      <SubscribeDialog
        open
        onOpenChange={() => {}}
        plan={{ ...plan, billedPer: 'workspace' }}
        endsTrial
        minSeats={4}
        discountMonths={2}
        period="annual"
      />
    )
    expect(screen.queryByText('Seats')).not.toBeInTheDocument()
    expect(screen.getByText('$288.00')).toBeInTheDocument()
    expect(document.querySelector('input[name="quantity"]')).toHaveValue('1')
  })
})
