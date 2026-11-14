// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import type { TicketFormField, TicketFormFieldType } from '@/lib/shared/tickets'
import { TicketFormFields } from '../ticket-form-fields'

afterEach(cleanup)

function field(key: string, label: string, type: TicketFormFieldType): TicketFormField {
  return {
    key,
    label,
    type,
    required: false,
    visibleToCustomer: true,
    order: 0,
    ...(type === 'select' ? { options: ['A', 'B'] } : {}),
  }
}

describe('TicketFormFields', () => {
  it('links each field label to its control', () => {
    render(
      <IntlProvider locale="en-US" messages={{}}>
        <TicketFormFields
          fields={[
            field('order_number', 'Order number', 'text'),
            field('steps', 'Steps to reproduce', 'long_text'),
            field('seats', 'Seats', 'number'),
            field('started', 'Started on', 'date'),
            field('plan', 'Plan', 'select'),
          ]}
          values={{}}
          onChange={() => {}}
        />
      </IntlProvider>
    )

    expect(screen.getByLabelText('Order number').tagName).toBe('INPUT')
    expect(screen.getByLabelText('Steps to reproduce').tagName).toBe('TEXTAREA')
    expect(screen.getByLabelText('Seats')).toHaveAttribute('type', 'number')
    expect(screen.getByLabelText('Started on')).toHaveAttribute('type', 'date')
    expect(screen.getByLabelText('Plan')).toBeTruthy()
  })
})
