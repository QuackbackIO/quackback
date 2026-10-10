// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FieldsEditor } from '../fields-editor'
import type { TicketFormField } from '@/lib/shared/tickets'

const FIELD: TicketFormField = {
  key: 'order_number',
  label: 'Order number',
  type: 'text',
  required: false,
  visibleToCustomer: true,
  order: 0,
}

afterEach(cleanup)

describe('FieldsEditor delete', () => {
  it('asks before removing a field and removes it only on confirm', () => {
    const onChange = vi.fn()
    render(<FieldsEditor category="customer" fields={[FIELD]} onChange={onChange} />)

    fireEvent.click(screen.getByTitle('Delete field'))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByText('Delete field?')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Delete field' }))
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('keeps the field when the confirmation is cancelled', () => {
    const onChange = vi.fn()
    render(<FieldsEditor category="customer" fields={[FIELD]} onChange={onChange} />)
    fireEvent.click(screen.getByTitle('Delete field'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onChange).not.toHaveBeenCalled()
  })
})
