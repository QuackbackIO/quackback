// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { GitHubUserMappings } from '../github-user-mappings'

type Mapping = {
  externalUsername: string
  principalId: string
}

type Member = {
  id: string
  name?: string | null
  email?: string | null
}

const mocks = vi.hoisted(() => ({
  mappings: [] as Mapping[],
  members: [] as Member[],
  mappingsRefetch: vi.fn(),
  upsertUserMapping: vi.fn(),
  deleteUserMapping: vi.fn(),
  upsertState: {
    isPending: false,
  },
  deleteState: {
    isPending: false,
  },
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey?: readonly unknown[] }) => {
    const key = options.queryKey ?? []
    if (key.includes('user-mappings')) {
      return {
        data: mocks.mappings,
        refetch: mocks.mappingsRefetch,
      }
    }
    return {
      data: mocks.members,
      refetch: vi.fn(),
    }
  },
}))

vi.mock('@/lib/client/mutations', () => ({
  useUpsertUserMapping: () => ({
    mutate: mocks.upsertUserMapping,
    ...mocks.upsertState,
  }),
  useDeleteUserMapping: () => ({
    mutate: mocks.deleteUserMapping,
    ...mocks.deleteState,
  }),
}))

vi.mock('@/lib/server/functions/integrations', () => ({
  fetchUserMappingsFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/admin', () => ({
  searchMembersFn: vi.fn(),
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, className }: { children: ReactNode; className?: string }) => (
    <label className={className}>{children}</label>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: ({
    value,
    onChange,
    disabled,
    placeholder,
  }: {
    value?: string
    onChange?: (event: { target: { value: string } }) => void
    disabled?: boolean
    placeholder?: string
    className?: string
  }) => (
    <input
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(event) => onChange?.({ target: { value: event.currentTarget.value } })}
    />
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode
    disabled?: boolean
    onClick?: () => void
    variant?: string
    size?: string
    className?: string
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/select', async () => {
  const React = await import('react')
  const SelectContext = React.createContext<{
    onValueChange?: (value: string) => void
    disabled?: boolean
  }>({})

  return {
    Select: ({
      value,
      onValueChange,
      disabled,
      children,
    }: {
      value?: string
      onValueChange?: (value: string) => void
      disabled?: boolean
      children?: ReactNode
    }) => (
      <SelectContext.Provider value={{ onValueChange, disabled }}>
        <div data-value={value}>{children}</div>
      </SelectContext.Provider>
    ),
    SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children, value }: { children: ReactNode; value: string }) => {
      const context = React.useContext(SelectContext)
      return (
        <button
          type="button"
          disabled={context.disabled}
          onClick={() => context.onValueChange?.(value)}
        >
          {children}
        </button>
      )
    },
    SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
  }
})

vi.mock('@heroicons/react/24/solid', () => ({
  PlusIcon: () => <span aria-hidden="true">plus</span>,
  TrashIcon: () => <span aria-hidden="true">trash</span>,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mappings = [
    {
      externalUsername: 'octocat',
      principalId: 'principal_1',
    },
    {
      externalUsername: 'unknown-user',
      principalId: 'principal_missing',
    },
  ]
  mocks.members = [
    {
      id: 'principal_1',
      name: 'Ada Lovelace',
      email: 'ada@example.test',
    },
    {
      id: 'principal_2',
      name: null,
      email: 'grace@example.test',
    },
  ]
  mocks.upsertState.isPending = false
  mocks.deleteState.isPending = false
  mocks.upsertUserMapping.mockImplementation((_payload, options) => options?.onSuccess?.())
  mocks.deleteUserMapping.mockImplementation((_payload, options) => options?.onSuccess?.())
})

describe('GitHubUserMappings', () => {
  it('renders existing mappings and deletes a GitHub username mapping', async () => {
    render(<GitHubUserMappings integrationId="github_1" />)

    expect(screen.getByText('@octocat')).toBeInTheDocument()
    expect(screen.getByText('@unknown-user')).toBeInTheDocument()
    expect(screen.getByText('principal_missing')).toBeInTheDocument()

    const row = screen.getByText('@octocat').closest('tr')
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getByText('Ada Lovelace')).toBeInTheDocument()
    fireEvent.click(within(row as HTMLElement).getByRole('button'))

    await waitFor(() => {
      expect(mocks.deleteUserMapping).toHaveBeenCalledWith(
        {
          integrationId: 'github_1',
          externalUsername: 'octocat',
        },
        expect.objectContaining({ onSuccess: expect.any(Function) })
      )
    })
    expect(mocks.mappingsRefetch).toHaveBeenCalled()
  })

  it('requires a username and member before adding a trimmed mapping', async () => {
    render(<GitHubUserMappings integrationId="github_1" />)

    expect(screen.getByRole('button', { name: /Add/ })).toBeDisabled()

    fireEvent.change(screen.getByPlaceholderText('octocat'), {
      target: { value: '  hubot  ' },
    })
    expect(screen.getByRole('button', { name: /Add/ })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'grace@example.test' }))
    fireEvent.click(screen.getByRole('button', { name: /Add/ }))

    await waitFor(() => {
      expect(mocks.upsertUserMapping).toHaveBeenCalledWith(
        {
          integrationId: 'github_1',
          externalUsername: 'hubot',
          principalId: 'principal_2',
        },
        expect.objectContaining({ onSuccess: expect.any(Function) })
      )
    })
    expect(mocks.mappingsRefetch).toHaveBeenCalled()
    expect(screen.getByPlaceholderText('octocat')).toHaveValue('')
  })

  it('disables destructive and add controls while the mapping editor is disabled', () => {
    render(<GitHubUserMappings integrationId="github_1" disabled />)

    expect(screen.getByPlaceholderText('octocat')).toBeDisabled()
    expect(screen.getByRole('button', { name: /Add/ })).toBeDisabled()

    const row = screen.getByText('@octocat').closest('tr')
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getByRole('button')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Ada Lovelace' })).toBeDisabled()
  })
})
