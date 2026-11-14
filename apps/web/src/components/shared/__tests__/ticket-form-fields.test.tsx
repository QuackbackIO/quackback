// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
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

  it('names required fields without the asterisk and marks them required', () => {
    const required = (f: TicketFormField): TicketFormField => ({ ...f, required: true })
    render(
      <IntlProvider locale="en-US" messages={{}}>
        <TicketFormFields
          fields={[
            required(field('order_number', 'Order number', 'text')),
            required(field('plan', 'Plan', 'select')),
            required(field('agree', 'I agree', 'checkbox')),
            field('notes', 'Notes', 'text'),
          ]}
          values={{}}
          onChange={() => {}}
        />
      </IntlProvider>
    )

    expect(screen.getByRole('textbox', { name: 'Order number' })).toBeRequired()
    expect(screen.getByRole('combobox', { name: 'Plan' })).toBeRequired()
    expect(screen.getByRole('checkbox', { name: 'I agree' })).toBeRequired()
    expect(screen.getByRole('textbox', { name: 'Notes' })).not.toBeRequired()
  })

  it('describes a field with its suggestion state instead of naming it', () => {
    render(
      <IntlProvider locale="en-US" messages={{}}>
        <TicketFormFields
          fields={[field('order_number', 'Order number', 'text'), field('notes', 'Notes', 'text')]}
          values={{ order_number: 'A-1' }}
          onChange={() => {}}
          suggestedKeys={new Set(['order_number'])}
          suggestionRun
        />
      </IntlProvider>
    )

    expect(screen.getByRole('textbox', { name: 'Order number' })).toHaveAccessibleDescription(
      '✨ suggested'
    )
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveAccessibleDescription(
      '— not suggested'
    )
  })
})
