// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BoardCustomFields } from '../board-custom-fields'
import type { BoardCustomField } from '@/lib/shared/db-types'

const FIELDS: BoardCustomField[] = [
  { key: 'use_case', label: 'Use case', type: 'text', required: true },
  { key: 'details', label: 'Details', type: 'long_text', required: false },
  { key: 'seats', label: 'Seats', type: 'number', required: false },
  { key: 'impact', label: 'Impact', type: 'select', required: true, options: ['low', 'high'] },
  { key: 'needed_by', label: 'Needed by', type: 'date', required: false },
  { key: 'read_docs', label: 'I read the docs', type: 'checkbox', required: true },
]

function renderFields(values: Record<string, unknown> = {}, onChange = vi.fn()) {
  render(<BoardCustomFields fields={FIELDS} values={values} onChange={onChange} />)
  return onChange
}

describe('<BoardCustomFields>', () => {
  it('renders each field in its declared input type', () => {
    renderFields()
    expect(screen.getByLabelText(/Use case/)).toHaveProperty('type', 'text')
    expect(screen.getByLabelText(/Details/).tagName).toBe('TEXTAREA')
    expect(screen.getByLabelText(/Seats/)).toHaveProperty('type', 'number')
    expect(screen.getByLabelText(/Needed by/)).toHaveProperty('type', 'date')
    expect(screen.getByRole('combobox', { name: /Impact/ })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: /I read the docs/ })).toBeTruthy()
  })

  it('marks required fields', () => {
    renderFields()
    expect(screen.getByText('Use case').parentElement?.textContent).toContain('*')
    expect(screen.getByText('Seats').parentElement?.textContent).not.toContain('*')
  })

  it('renders nothing when the board configures no fields', () => {
    const { container } = render(<BoardCustomFields fields={[]} values={{}} onChange={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('reports text edits by field key', () => {
    const onChange = renderFields()
    fireEvent.change(screen.getByLabelText(/Use case/), { target: { value: 'Billing' } })
    expect(onChange).toHaveBeenCalledWith('use_case', 'Billing')
  })

  it('reports checkbox toggles as booleans', () => {
    const onChange = renderFields()
    fireEvent.click(screen.getByRole('checkbox', { name: /I read the docs/ }))
    expect(onChange).toHaveBeenCalledWith('read_docs', true)
  })

  it('renders select options from the field declaration', () => {
    renderFields({ impact: 'high' })
    const trigger = screen.getByRole('combobox', { name: /Impact/ })
    expect(trigger.textContent).toContain('high')
  })
})
