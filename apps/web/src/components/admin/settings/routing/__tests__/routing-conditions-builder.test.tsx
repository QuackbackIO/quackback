// @vitest-environment happy-dom
import { useState, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { RoutingConditionsBuilder, type BuilderRuleSet } from '../routing-conditions-builder'

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    type = 'button',
    'aria-label': ariaLabel,
  }: {
    children: ReactNode
    onClick?: () => void
    type?: 'button' | 'submit' | 'reset'
    'aria-label'?: string
    variant?: string
    size?: string
    className?: string
  }) => (
    <button type={type} onClick={onClick} aria-label={ariaLabel}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: ({
    value,
    onChange,
    placeholder,
  }: {
    value?: string
    onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
    placeholder?: string
    className?: string
  }) => <input value={value} onChange={onChange} placeholder={placeholder} />,
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string
    onValueChange: (value: string) => void
    children: ReactNode
  }) => (
    <select value={value} onChange={(event) => onValueChange(event.currentTarget.value)}>
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
}))

vi.mock('@heroicons/react/24/outline', () => ({
  TrashIcon: () => <span />,
  PlusIcon: () => <span />,
}))

const onChange = vi.fn()

function Harness({ initial }: { initial: BuilderRuleSet }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <RoutingConditionsBuilder
        value={value}
        onChange={(next) => {
          onChange(next)
          setValue(next)
        }}
      />
      <pre data-testid="value">{JSON.stringify(value)}</pre>
    </>
  )
}

function currentValue(): BuilderRuleSet {
  return JSON.parse(screen.getByTestId('value').textContent ?? '{}') as BuilderRuleSet
}

beforeEach(() => {
  onChange.mockClear()
})

describe('RoutingConditionsBuilder', () => {
  it('adds, removes, and changes match mode for conditions', () => {
    render(<Harness initial={{ match: 'all', conditions: [] }} />)

    fireEvent.click(screen.getByRole('button', { name: 'Any' }))
    expect(currentValue().match).toBe('any')

    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }))
    expect(currentValue().conditions).toEqual([{ field: 'subject', op: 'contains', value: '' }])

    fireEvent.click(screen.getByRole('button', { name: 'Remove condition' }))
    expect(currentValue().conditions).toEqual([])
  })

  it('edits scalar values and normalizes when switching to and from in-operator arrays', () => {
    render(
      <Harness
        initial={{
          match: 'all',
          conditions: [{ field: 'subject', op: 'contains', value: 'billing' }],
        }}
      />
    )

    fireEvent.change(screen.getByPlaceholderText(/value/), {
      target: { value: 'invoice' },
    })
    expect(currentValue().conditions[0]).toEqual({
      field: 'subject',
      op: 'contains',
      value: 'invoice',
    })

    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'in' } })
    expect(currentValue().conditions[0].value).toEqual(['invoice'])

    fireEvent.change(screen.getByPlaceholderText(/value1/), {
      target: { value: 'alpha, beta, , gamma ' },
    })
    expect(currentValue().conditions[0].value).toEqual(['alpha', 'beta', 'gamma'])

    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'matches' } })
    expect(currentValue().conditions[0]).toEqual({
      field: 'subject',
      op: 'matches',
      value: 'alpha',
    })
    expect(screen.getByPlaceholderText(/regex/)).toBeInTheDocument()
  })

  it('resets values when changing fields and supports enum scalar selects', () => {
    render(
      <Harness
        initial={{
          match: 'all',
          conditions: [{ field: 'subject', op: 'eq', value: 'existing' }],
        }}
      />
    )

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'priority' } })
    expect(currentValue().conditions[0]).toEqual({
      field: 'priority',
      op: 'eq',
      value: '',
    })

    fireEvent.change(screen.getAllByRole('combobox')[2], { target: { value: 'urgent' } })
    expect(currentValue().conditions[0].value).toBe('urgent')
  })

  it('supports enum in-operator toggles for ticket channels and inbox channel kinds', () => {
    const view = render(
      <Harness
        initial={{
          match: 'all',
          conditions: [{ field: 'channel', op: 'in', value: ['email'] }],
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'email' }))
    expect(currentValue().conditions[0].value).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'widget' }))
    expect(currentValue().conditions[0].value).toEqual(['widget'])

    view.unmount()
    render(
      <Harness
        initial={{
          match: 'all',
          conditions: [{ field: 'inboxChannelKind', op: 'in', value: [] }],
        }}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'webhook' }))
    expect(currentValue().conditions[0].value).toEqual(['webhook'])
  })
})
