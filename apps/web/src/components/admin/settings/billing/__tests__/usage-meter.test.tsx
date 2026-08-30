// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UsageMeter } from '../usage-meter'

describe('UsageMeter', () => {
  it('puts the label and description on the left of a full-width bar', () => {
    render(
      <UsageMeter
        label="Emails"
        description="Billable outbound mail this month."
        valueText="80 of 5,000"
        used={80}
        limit={5_000}
      />
    )
    expect(screen.getByText('Emails')).toBeInTheDocument()
    expect(screen.getByText('Billable outbound mail this month.')).toBeInTheDocument()
    expect(screen.getByText('80 of 5,000')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '80')
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '5000')
  })
})
