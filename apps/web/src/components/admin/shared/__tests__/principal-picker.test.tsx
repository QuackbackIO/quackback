// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PrincipalPicker } from '../principal-picker'

type PrincipalRow = {
  id: string
  displayName: string | null
  email: string | null
  avatarUrl: string | null
  role: string
}

const mocks = vi.hoisted(() => ({
  searchPrincipalsFn: vi.fn(),
  getPrincipalsByIdsFn: vi.fn(),
  searchRows: [] as PrincipalRow[],
  selectedRows: [] as PrincipalRow[],
  searchLoading: false,
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: {
    queryKey: readonly unknown[]
    queryFn: () => unknown
    enabled?: boolean
  }) => {
    const [, kind] = options.queryKey
    if (options.enabled === false) {
      return {
        data: undefined,
        isLoading: false,
      }
    }
    options.queryFn()
    return {
      data: kind === 'search' ? mocks.searchRows : mocks.selectedRows,
      isLoading: kind === 'search' ? mocks.searchLoading : false,
    }
  },
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    disabled,
    onClick,
    role,
    'aria-expanded': ariaExpanded,
  }: {
    children: ReactNode
    disabled?: boolean
    onClick?: () => void
    role?: string
    'aria-expanded'?: boolean
    variant?: string
    className?: string
  }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      role={role}
      aria-expanded={ariaExpanded}
    >
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/popover', () => {
  let currentOpen = false
  let setOpen: (open: boolean) => void = () => undefined

  return {
    Popover: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean
      onOpenChange: (open: boolean) => void
      children: ReactNode
    }) => {
      currentOpen = open
      setOpen = onOpenChange
      return <div>{children}</div>
    },
    PopoverTrigger: ({ children }: { children: ReactNode; asChild?: boolean }) => (
      <span onClick={() => setOpen(true)}>{children}</span>
    ),
    PopoverContent: ({ children }: { children: ReactNode; className?: string; align?: string }) =>
      currentOpen ? <section role="listbox">{children}</section> : null,
    PopoverAnchor: ({ children }: { children: ReactNode }) => <>{children}</>,
  }
})

vi.mock('@/components/ui/command', () => ({
  Command: ({ children }: { children: ReactNode; shouldFilter?: boolean }) => <div>{children}</div>,
  CommandEmpty: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandInput: ({
    value,
    onValueChange,
    placeholder,
  }: {
    value: string
    onValueChange: (value: string) => void
    placeholder?: string
  }) => (
    <input
      aria-label={placeholder}
      value={value}
      onChange={(event) => onValueChange(event.currentTarget.value)}
    />
  ),
  CommandItem: ({
    children,
    onSelect,
    value,
  }: {
    children: ReactNode
    onSelect?: (value: string) => void
    value: string
    className?: string
  }) => (
    <button type="button" role="option" onClick={() => onSelect?.(value)}>
      {children}
    </button>
  ),
  CommandList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/avatar', () => ({
  Avatar: ({ name, src }: { name?: string | null; src?: string | null; className?: string }) => (
    <span>{src ? `avatar:${src}` : `avatar:${name ?? 'empty'}`}</span>
  ),
}))

vi.mock('@heroicons/react/24/solid', () => ({
  CheckIcon: ({ className }: { className?: string }) => (
    <span data-class-name={className}>check</span>
  ),
  ChevronUpDownIcon: () => <span aria-hidden="true">chevron</span>,
}))

vi.mock('@/lib/server/functions/principals', () => ({
  searchPrincipalsFn: mocks.searchPrincipalsFn,
  getPrincipalsByIdsFn: mocks.getPrincipalsByIdsFn,
}))

function row(overrides: Partial<PrincipalRow>): PrincipalRow {
  return {
    id: 'principal_1',
    displayName: 'Ada Admin',
    email: 'ada@example.com',
    avatarUrl: null,
    role: 'admin',
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.searchLoading = false
  mocks.searchRows = [
    row({ id: 'principal_1', displayName: 'Ada Admin', email: 'ada@example.com' }),
    row({
      id: 'principal_email_only',
      displayName: null,
      email: 'email-only@example.com',
      role: 'user',
    }),
    row({
      id: 'principal_id_only',
      displayName: null,
      email: null,
      role: 'agent',
      avatarUrl: 'https://example.com/avatar.png',
    }),
  ]
  mocks.selectedRows = [row({ id: 'principal_1', displayName: 'Ada Admin' })]
  mocks.searchPrincipalsFn.mockImplementation(() => mocks.searchRows)
  mocks.getPrincipalsByIdsFn.mockImplementation(() => mocks.selectedRows)
})

afterEach(() => {
  vi.useRealTimers()
})

function openPicker() {
  fireEvent.click(screen.getByRole('combobox'))
}

describe('PrincipalPicker', () => {
  it('renders placeholder labels, opens search and sends debounced search parameters', () => {
    const onValueChange = vi.fn()
    render(
      <PrincipalPicker
        value={null}
        onValueChange={onValueChange}
        placeholder="Pick person"
        roleFilter={['user']}
        excludeIds={['principal_1' as never]}
        allowUnassigned
      />
    )

    expect(screen.getByRole('combobox')).toHaveTextContent('Pick person')
    expect(mocks.searchPrincipalsFn).not.toHaveBeenCalled()

    openPicker()
    expect(mocks.searchPrincipalsFn).toHaveBeenLastCalledWith({
      data: {
        query: undefined,
        roleFilter: ['user'],
        excludeIds: ['principal_1'],
        limit: 25,
      },
    })

    fireEvent.change(screen.getByLabelText('Search by name or email…'), {
      target: { value: 'ada' },
    })
    act(() => {
      vi.advanceTimersByTime(250)
    })

    expect(mocks.searchPrincipalsFn).toHaveBeenLastCalledWith({
      data: {
        query: 'ada',
        roleFilter: ['user'],
        excludeIds: ['principal_1'],
        limit: 25,
      },
    })
    expect(screen.getByText('Ada Admin')).toBeInTheDocument()
    expect(screen.getAllByText('email-only@example.com')).toHaveLength(2)
    expect(screen.getByText('principal_id_only')).toBeInTheDocument()
    expect(screen.getByText('avatar:https://example.com/avatar.png')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('option', { name: /Unassigned/ }))
    expect(onValueChange).toHaveBeenCalledWith(null)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('selects a single principal, closes the popover and resolves selected labels', () => {
    const onValueChange = vi.fn()
    const { rerender } = render(<PrincipalPicker value={null} onValueChange={onValueChange} />)

    openPicker()
    fireEvent.click(screen.getByRole('option', { name: /Ada Admin/ }))

    expect(onValueChange).toHaveBeenCalledWith('principal_1')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    rerender(<PrincipalPicker value={'principal_1' as never} onValueChange={onValueChange} />)
    expect(mocks.getPrincipalsByIdsFn).toHaveBeenCalledWith({
      data: { ids: ['principal_1'] },
    })
    expect(screen.getByRole('combobox')).toHaveTextContent('Ada Admin')
  })

  it('adds and removes selections in multi-select mode and renders selected counts', () => {
    const onValueChange = vi.fn()
    const { rerender } = render(
      <PrincipalPicker
        multiple
        value={[]}
        onValueChange={onValueChange}
        placeholder="Select recipients"
      />
    )

    expect(screen.getByRole('combobox')).toHaveTextContent('Select recipients')
    openPicker()
    fireEvent.click(screen.getByRole('option', { name: /Ada Admin/ }))
    expect(onValueChange).toHaveBeenCalledWith(['principal_1'])

    mocks.selectedRows = [row({ id: 'principal_1', displayName: null, email: 'ada@example.com' })]
    rerender(
      <PrincipalPicker multiple value={['principal_1' as never]} onValueChange={onValueChange} />
    )
    expect(screen.getByRole('combobox')).toHaveTextContent('ada@example.com')

    openPicker()
    fireEvent.click(screen.getByRole('option', { name: /Ada Admin/ }))
    expect(onValueChange).toHaveBeenCalledWith([])

    rerender(
      <PrincipalPicker
        multiple
        value={['principal_1' as never, 'principal_2' as never]}
        onValueChange={onValueChange}
      />
    )
    expect(screen.getByRole('combobox')).toHaveTextContent('2 selected')
  })

  it('renders loading and no-match states and respects disabled trigger state', () => {
    mocks.searchRows = []
    mocks.searchLoading = true
    const { rerender } = render(<PrincipalPicker value={null} onValueChange={vi.fn()} disabled />)

    expect(screen.getByRole('combobox')).toBeDisabled()

    rerender(<PrincipalPicker value={null} onValueChange={vi.fn()} />)
    openPicker()
    expect(screen.getByText('Searching…')).toBeInTheDocument()

    mocks.searchLoading = false
    rerender(<PrincipalPicker value={null} onValueChange={vi.fn()} />)
    expect(screen.getByText('No matches.')).toBeInTheDocument()
  })
})
