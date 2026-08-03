// @vitest-environment happy-dom
import type { ChangeEvent, ComponentProps, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CreateApiKeyDialog } from '../create-api-key-dialog'
import { EditApiKeyDialog } from '../edit-api-key-dialog'

type CreateResultKey = Parameters<ComponentProps<typeof CreateApiKeyDialog>['onKeyCreated']>[0]
type EditApiKeyProp = ComponentProps<typeof EditApiKeyDialog>['apiKey']

type ButtonProps = {
  children: ReactNode
  disabled?: boolean
  onClick?: () => void
  type?: 'button' | 'submit' | 'reset'
  variant?: string
  size?: string
  className?: string
}

const mocks = vi.hoisted(() => ({
  createApiKeyFn: vi.fn(),
  updateApiKeyFn: vi.fn(),
  invalidateQueries: vi.fn(),
  routerInvalidate: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({
    invalidate: mocks.routerInvalidate,
  }),
}))

vi.mock('@/lib/server/functions/api-keys', () => ({
  createApiKeyFn: mocks.createApiKeyFn,
  updateApiKeyFn: mocks.updateApiKeyFn,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, disabled, onClick, type = 'button' }: ButtonProps) => (
    <button type={type} disabled={disabled} onClick={onClick}>
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
    disabled,
  }: {
    id?: string
    value?: string
    onChange?: (event: ChangeEvent<HTMLInputElement>) => void
    placeholder?: string
    disabled?: boolean
    maxLength?: number
    autoFocus?: boolean
  }) => (
    <input
      id={id}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
    />
  ),
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({
    children,
  }: {
    children: ReactNode
    open?: boolean
    onOpenChange?: (open: boolean) => void
  }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: ReactNode; className?: string }) => (
    <section>{children}</section>
  ),
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}))

vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({
    id,
    checked,
    disabled,
    onCheckedChange,
  }: {
    id?: string
    checked: boolean
    disabled?: boolean
    onCheckedChange: () => void
  }) => (
    <input
      id={id}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={onCheckedChange}
    />
  ),
}))

vi.mock('@/components/admin/shared/team-picker', () => ({
  TeamPicker: ({
    onValueChange,
    disabled,
  }: {
    multiple?: boolean
    value: string[]
    onValueChange: (value: string[]) => void
    includeArchived?: boolean
    disabled?: boolean
  }) => (
    <button type="button" disabled={disabled} onClick={() => onValueChange(['team_support'])}>
      Add team restriction
    </button>
  ),
}))

vi.mock('@/components/admin/shared/inbox-picker', () => ({
  InboxPicker: ({
    onValueChange,
    disabled,
  }: {
    multiple?: boolean
    value: string[]
    onValueChange: (value: string[]) => void
    includeArchived?: boolean
    disabled?: boolean
  }) => (
    <button type="button" disabled={disabled} onClick={() => onValueChange(['inbox_support'])}>
      Add inbox restriction
    </button>
  ),
}))

vi.mock('@/components/shared/warning-box', () => ({
  WarningBox: ({
    title,
    description,
  }: {
    variant?: string
    title: string
    description: string
  }) => (
    <section>
      <h3>{title}</h3>
      <p>{description}</p>
    </section>
  ),
}))

function apiKey(overrides: Partial<EditApiKeyProp> = {}): EditApiKeyProp {
  return {
    id: 'api_key_1',
    name: 'Primary key',
    keyPrefix: 'qb_live_123',
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    lastUsedAt: null,
    scopes: ['org.view'],
    allowedTeamIds: ['team_existing'],
    allowedInboxIds: ['inbox_existing'],
    compatLegacyFullAccess: false,
    ...overrides,
  } as unknown as EditApiKeyProp
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  mocks.createApiKeyFn.mockResolvedValue({
    apiKey: apiKey({ id: 'api_key_created', name: 'Created key' }) as unknown as CreateResultKey,
    plainTextKey: 'qb_plain',
  })
  mocks.updateApiKeyFn.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CreateApiKeyDialog', () => {
  it('validates name, submits selected scopes and restrictions, and resets through callback', async () => {
    const onOpenChange = vi.fn()
    const onKeyCreated = vi.fn()
    render(<CreateApiKeyDialog open onOpenChange={onOpenChange} onKeyCreated={onKeyCreated} />)

    expect(screen.getByText('No scopes selected')).toBeInTheDocument()
    fireEvent.submit(screen.getByRole('button', { name: 'Create Key' }).closest('form')!)
    expect(screen.getByText('Please enter a name for the API key')).toBeInTheDocument()
    expect(mocks.createApiKeyFn).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Production bot  ' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Select all' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Add team restriction' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add inbox restriction' }))
    fireEvent.submit(screen.getByRole('button', { name: 'Create Key' }).closest('form')!)

    await waitFor(() => {
      expect(mocks.createApiKeyFn).toHaveBeenCalledWith({
        data: {
          name: 'Production bot',
          scopes: expect.arrayContaining(['ticket.view_all']),
          allowedTeamIds: ['team_support'],
          allowedInboxIds: ['inbox_support'],
        },
      })
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['admin', 'api-keys'],
    })
    expect(mocks.routerInvalidate).toHaveBeenCalled()
    expect(onKeyCreated).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'api_key_created' }),
      'qb_plain'
    )
  })

  it('resets local state when cancelled and reports server failures', async () => {
    const onOpenChange = vi.fn()
    const onKeyCreated = vi.fn()
    mocks.createApiKeyFn.mockRejectedValueOnce(new Error('Create denied'))
    render(<CreateApiKeyDialog open onOpenChange={onOpenChange} onKeyCreated={onKeyCreated} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Bad key' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Select all' })[0])
    fireEvent.submit(screen.getByRole('button', { name: 'Create Key' }).closest('form')!)

    await waitFor(() => {
      expect(screen.getByText('Create denied')).toBeInTheDocument()
    })
    expect(onKeyCreated).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('EditApiKeyDialog', () => {
  it('resets from the api key prop, validates name, and submits trimmed updates', async () => {
    const onOpenChange = vi.fn()
    const { rerender } = render(
      <EditApiKeyDialog open onOpenChange={onOpenChange} apiKey={apiKey()} />
    )

    expect(screen.getByLabelText('Name')).toHaveValue('Primary key')

    rerender(
      <EditApiKeyDialog
        open
        onOpenChange={onOpenChange}
        apiKey={apiKey({ id: 'api_key_2', name: 'Second key', scopes: [] })}
      />
    )
    expect(screen.getByLabelText('Name')).toHaveValue('Second key')

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '   ' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Save changes' }).closest('form')!)
    expect(screen.getByText('Name is required')).toBeInTheDocument()
    expect(mocks.updateApiKeyFn).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Scoped key  ' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Select all' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Add team restriction' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add inbox restriction' }))
    fireEvent.submit(screen.getByRole('button', { name: 'Save changes' }).closest('form')!)

    await waitFor(() => {
      expect(mocks.updateApiKeyFn).toHaveBeenCalledWith({
        data: {
          id: 'api_key_2',
          name: 'Scoped key',
          scopes: expect.arrayContaining(['ticket.view_all']),
          allowedTeamIds: ['team_support'],
          allowedInboxIds: ['inbox_support'],
        },
      })
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['admin', 'api-keys'],
    })
    expect(mocks.routerInvalidate).toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('reports update failures and closes through cancel', async () => {
    const onOpenChange = vi.fn()
    mocks.updateApiKeyFn.mockRejectedValueOnce(new Error('Update denied'))
    render(<EditApiKeyDialog open onOpenChange={onOpenChange} apiKey={apiKey()} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Valid name' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Save changes' }).closest('form')!)

    await waitFor(() => {
      expect(screen.getByText('Update denied')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
