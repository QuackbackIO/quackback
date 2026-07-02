// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CUSTOM_ATTR_PREFIX, SegmentFormDialog } from '../segment-form'

const mocks = vi.hoisted(() => ({
  fetchSegmentAttributeValuesFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/admin', () => ({
  fetchSegmentAttributeValuesFn: mocks.fetchSegmentAttributeValuesFn,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    type = 'button',
  }: {
    children: ReactNode
    onClick?: () => void
    disabled?: boolean
    type?: 'button' | 'submit' | 'reset'
    variant?: string
    size?: string
    className?: string
  }) => (
    <button type={type} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: ({
    id,
    value,
    onChange,
    placeholder,
    type = 'text',
    required,
  }: {
    id?: string
    value?: string
    onChange?: (event: { target: { value: string } }) => void
    placeholder?: string
    type?: string
    required?: boolean
    className?: string
  }) => (
    <input
      id={id}
      value={value}
      type={type}
      required={required}
      placeholder={placeholder}
      onChange={(event) => onChange?.({ target: { value: event.currentTarget.value } })}
    />
  ),
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor }: { children: ReactNode; htmlFor?: string; className?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({
    children,
    open,
  }: {
    children: ReactNode
    open: boolean
    onOpenChange?: (open: boolean) => void
  }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: ReactNode; className?: string }) => (
    <section role="dialog">{children}</section>
  ),
  DialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}))

vi.mock('@/components/ui/select', async () => {
  const React = await import('react')
  const SelectContext = React.createContext<{
    onValueChange?: (value: string) => void
    value?: string
  }>({})
  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value?: string
      onValueChange?: (value: string) => void
      children?: ReactNode
    }) => (
      <SelectContext.Provider value={{ onValueChange, value }}>
        <div data-value={value}>{children}</div>
      </SelectContext.Provider>
    ),
    SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectItem: ({
      children,
      value,
    }: {
      children: ReactNode
      value: string
      className?: string
    }) => {
      const context = React.useContext(SelectContext)
      return (
        <button type="button" data-value={value} onClick={() => context.onValueChange?.(value)}>
          {children}
        </button>
      )
    },
    SelectLabel: ({ children }: { children: ReactNode; className?: string }) => (
      <strong>{children}</strong>
    ),
    SelectSeparator: () => <hr />,
    SelectTrigger: ({ children }: { children?: ReactNode; className?: string }) => <>{children}</>,
    SelectValue: () => {
      const context = React.useContext(SelectContext)
      return <span>{context.value}</span>
    },
  }
})

vi.mock('@/components/ui/searchable-input', () => ({
  SearchableInput: ({
    value,
    onChange,
    placeholder,
    fetchOptions,
  }: {
    className?: string
    value: string
    onChange: (value: string) => void
    placeholder?: string
    fetchOptions: (query: string) => Promise<Array<{ value: string; meta: string }>>
  }) => (
    <section>
      <input
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      <button
        type="button"
        onClick={async () => {
          const options = await fetchOptions('de')
          onChange(options[0]?.value ?? '')
        }}
      >
        Fetch typeahead
      </button>
    </section>
  ),
}))

vi.mock('@heroicons/react/24/solid', () => ({
  PlusIcon: () => <span aria-hidden="true">plus</span>,
  XMarkIcon: () => <span aria-hidden="true">remove</span>,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.fetchSegmentAttributeValuesFn.mockResolvedValue({
    values: [
      { value: 'Germany', count: 1 },
      { value: 'Denmark', count: 2 },
    ],
  })
})

describe('SegmentFormDialog', () => {
  it('renders dynamic rule controls, fetches searchable values, and submits trimmed edit values', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <SegmentFormDialog
        open
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        customAttributes={[
          {
            id: 'attr_1',
            key: 'annual_spend',
            label: 'Annual spend',
            type: 'currency',
            currencyCode: 'USD',
          },
          {
            id: 'attr_2',
            key: 'contract_signed',
            label: 'Contract signed',
            type: 'boolean',
          },
        ]}
        initialValues={{
          id: 'segment_1' as never,
          name: ' Enterprise ',
          description: ' Important accounts ',
          type: 'dynamic',
          rules: {
            match: 'any',
            conditions: [
              {
                attribute: 'metadata_key',
                operator: 'eq',
                metadataKey: 'tier',
                value: 'gold',
              },
              {
                attribute: 'country',
                operator: 'eq',
                value: 'DE',
              },
              {
                attribute: 'email_verified',
                operator: 'eq',
                value: 'true',
              },
              {
                attribute: 'principal_type',
                operator: 'eq',
                value: 'user',
              },
              {
                attribute: 'created_at_days_ago',
                operator: 'gt',
                value: '30',
              },
              {
                attribute: `${CUSTOM_ATTR_PREFIX}annual_spend`,
                operator: 'gte',
                value: '1000',
                metadataKey: 'annual_spend',
              },
            ],
          },
        }}
      />
    )

    expect(screen.getByRole('heading', { name: 'Edit Segment' })).toBeInTheDocument()
    expect(screen.getAllByText('Built-in fields').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Account').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Customers').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Activity').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Custom attributes').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Annual spend').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Contract signed').length).toBeGreaterThan(0)
    expect(screen.getByDisplayValue('tier')).toBeInTheDocument()
    expect(screen.getByDisplayValue('1000')).toHaveAttribute('type', 'number')
    expect(screen.getByDisplayValue('30')).toHaveAttribute('type', 'number')
    expect(screen.getByText(/Your team and admins won't show up here/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: ' Enterprise Plus ' } })
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: ' Priority customers ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Fetch typeahead' }))

    await waitFor(() => {
      expect(mocks.fetchSegmentAttributeValuesFn).toHaveBeenCalledWith({
        data: { attribute: 'country', query: 'de', limit: 20 },
      })
    })
    expect(screen.getByDisplayValue('Germany')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'Enterprise Plus',
        description: 'Priority customers',
        type: 'dynamic',
        rules: expect.objectContaining({
          match: 'any',
          conditions: expect.arrayContaining([
            expect.objectContaining({ attribute: 'metadata_key', metadataKey: 'tier' }),
            expect.objectContaining({ attribute: 'country', value: 'Germany' }),
            expect.objectContaining({ attribute: `${CUSTOM_ATTR_PREFIX}annual_spend` }),
          ]),
        }),
      })
    })
  })

  it('creates a dynamic segment after adding a rule and supports cancel', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const onOpenChange = vi.fn()
    render(<SegmentFormDialog open onOpenChange={onOpenChange} onSubmit={onSubmit} />)

    expect(screen.getByRole('heading', { name: 'Create Segment' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create segment' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Trial users' } })
    fireEvent.click(screen.getByRole('button', { name: /dynamic/i }))
    expect(screen.getByRole('button', { name: 'Create segment' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }))
    fireEvent.click(screen.getByRole('button', { name: 'ANY' }))
    fireEvent.change(screen.getByPlaceholderText('Type to search'), { target: { value: 'Ada' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create segment' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'Trial users',
        description: '',
        type: 'dynamic',
        rules: {
          match: 'any',
          conditions: [expect.objectContaining({ attribute: 'name', value: 'Ada' })],
        },
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
