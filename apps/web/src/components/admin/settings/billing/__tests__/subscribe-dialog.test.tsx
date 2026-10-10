// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SubscribeDialog } from '../subscribe-dialog'

const plan = {
  id: 'business' as const,
  name: 'Business',
  rank: 2,
  priceMonthlyCents: 7500,
  priceYearlyCents: 70800,
  billedPer: 'workspace' as const,
  bestFor: 'Teams',
  highlights: [],
  recommended: true,
}

describe('SubscribeDialog', () => {
  it('shows catalogue due-today for one workspace', () => {
    render(<SubscribeDialog open onOpenChange={() => {}} plan={plan} endsTrial period="annual" />)
    expect(screen.queryByText('Seats')).not.toBeInTheDocument()
    expect(screen.getByText(/Due today/)).toBeInTheDocument()
    expect(screen.getByText('$708.00')).toBeInTheDocument()
    expect(screen.getByText(/Billing starts today and your trial ends/)).toBeInTheDocument()
    expect(screen.queryByText(/checkout page/)).not.toBeInTheDocument()
    const form = document.querySelector('form')
    expect(form?.querySelector('input[name="quantity"]')).toHaveValue('1')
    expect(form?.querySelector('input[name="billingPeriod"]')).toHaveValue('annual')
  })

  it('drops the trial sentence for Free-to-paid', () => {
    render(
      <SubscribeDialog open onOpenChange={() => {}} plan={plan} endsTrial={false} period="annual" />
    )
    expect(screen.queryByText(/your trial ends/)).not.toBeInTheDocument()
    expect(screen.getByText(/Payment is handled by Stripe/)).toBeInTheDocument()
    expect(screen.queryByText(/checkout page/)).not.toBeInTheDocument()
  })

  it('switches due-today to monthly stickers', () => {
    render(<SubscribeDialog open onOpenChange={() => {}} plan={plan} endsTrial period="annual" />)
    fireEvent.click(screen.getByRole('radio', { name: 'Monthly' }))
    expect(screen.getByText('$75.00')).toBeInTheDocument()
  })

  it('opens on the period selected on the plans page', () => {
    render(<SubscribeDialog open onOpenChange={() => {}} plan={plan} endsTrial period="monthly" />)
    expect(screen.getByRole('radio', { name: 'Monthly' })).toHaveAttribute('aria-checked', 'true')
    expect(document.querySelector('input[name="billingPeriod"]')).toHaveValue('monthly')
    expect(screen.getByText('$75.00')).toBeInTheDocument()
  })
})
