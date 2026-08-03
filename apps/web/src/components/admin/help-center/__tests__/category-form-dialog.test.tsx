// @vitest-environment happy-dom
import type { ChangeEvent, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CategoryFormDialog } from '../category-form-dialog'

type CategoryRow = {
  id: string
  parentId: string | null
  name: string
  icon: string | null
  articleCount: number
}

const mocks = vi.hoisted(() => ({
  categories: [] as CategoryRow[],
  segments: [] as Array<{ id: string; name: string; memberCount: number }>,
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey?: unknown[] }) => {
    if (options.queryKey?.[0] === 'segments') return { data: mocks.segments }
    return { data: mocks.categories }
  },
}))

vi.mock('@/lib/client/queries/help-center', () => ({
  helpCenterQueries: {
    categories: () => ({ queryKey: ['help-center', 'categories'] }),
  },
}))

vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: {
    segments: () => ({ queryKey: ['segments'] }),
  },
}))

vi.mock('@/lib/client/mutations/help-center', () => ({
  useCreateCategory: () => ({
    isPending: false,
    mutateAsync: mocks.createCategory,
  }),
  useUpdateCategory: () => ({
    isPending: false,
    mutateAsync: mocks.updateCategory,
  }),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    disabled,
    onClick,
    type = 'button',
  }: {
    children: ReactNode
    disabled?: boolean
    onClick?: () => void
    type?: 'button' | 'submit' | 'reset'
    variant?: string
  }) => (
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
  }: {
    id?: string
    value?: string
    onChange?: (event: ChangeEvent<HTMLInputElement>) => void
    placeholder?: string
    required?: boolean
    className?: string
  }) => <input id={id} value={value} onChange={onChange} placeholder={placeholder} />,
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor }: { children: ReactNode; htmlFor?: string; className?: string }) => (
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

vi.mock('@/components/ui/popover', () => ({
  Popover: ({
    children,
  }: {
    children: ReactNode
    open?: boolean
    onOpenChange?: (open: boolean) => void
  }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: ReactNode; className?: string; align?: string }) => (
    <div>{children}</div>
  ),
  PopoverTrigger: ({ children }: { children: ReactNode; asChild?: boolean }) => <>{children}</>,
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children: ReactNode
    value: string
    onValueChange: (value: string) => void
  }) => (
    <select
      aria-label={value === 'public' || value === 'targeted' ? 'Audience' : 'Parent category'}
      value={value}
      onChange={(event) => onValueChange(event.currentTarget.value)}
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
  }: {
    checked: boolean
    onCheckedChange: (checked: boolean) => void
  }) => (
    <input
      aria-label="Enabled"
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange(event.currentTarget.checked)}
    />
  ),
}))

vi.mock('@/components/admin/segments/segment-multi-select', () => ({
  SegmentMultiSelect: ({
    onChange,
  }: {
    segments: Array<{ id: string; name: string; memberCount: number }>
    value: string[]
    onChange: (value: string[]) => void
    ariaLabel?: string
  }) => (
    <button type="button" onClick={() => onChange(['segment_vip'])}>
      Add segment
    </button>
  ),
}))

vi.mock('@/components/admin/shared/principal-picker', () => ({
  PrincipalPicker: ({
    onValueChange,
  }: {
    multiple?: boolean
    roleFilter?: string[]
    value: string[]
    onValueChange: (value: string[]) => void
    placeholder?: string
  }) => (
    <button type="button" onClick={() => onValueChange(['principal_1'])}>
      Add user
    </button>
  ),
}))

vi.mock('@/components/help-center/category-icon', () => ({
  ALL_ICON_KEYS: ['FolderIcon', 'SparklesIcon'],
  ICON_LOOKUP: {
    FolderIcon: () => <span>folder icon</span>,
    SparklesIcon: () => <span>sparkles icon</span>,
  },
  CategoryIcon: ({ icon }: { icon?: string | null; className?: string }) => (
    <span>icon:{icon ?? 'none'}</span>
  ),
}))

function category(overrides: Partial<CategoryRow> = {}): CategoryRow {
  return {
    id: 'cat_root',
    parentId: null,
    name: 'Root',
    icon: 'FolderIcon',
    articleCount: 0,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.categories = [
    category(),
    category({ id: 'cat_child', parentId: 'cat_root', name: 'Child' }),
    category({ id: 'cat_grandchild', parentId: 'cat_child', name: 'Grandchild' }),
  ]
  mocks.segments = [{ id: 'segment_vip', name: 'VIP', memberCount: 12 }]
  mocks.createCategory.mockResolvedValue({ id: 'cat_created' })
  mocks.updateCategory.mockResolvedValue({ id: 'cat_child' })
})

describe('CategoryFormDialog', () => {
  it('creates targeted categories with a selected icon, parent, segment and user', async () => {
    const onOpenChange = vi.fn()
    const onCreated = vi.fn()
    render(
      <CategoryFormDialog
        open
        onOpenChange={onOpenChange}
        defaultParentId={'cat_root' as never}
        onCreated={onCreated}
      />
    )

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Billing  ' } })
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: '  Account help  ' },
    })
    fireEvent.change(screen.getByPlaceholderText(/Search icons/), {
      target: { value: 'spark' },
    })
    fireEvent.click(screen.getByTitle('sparkles'))
    fireEvent.change(screen.getByLabelText('Audience'), { target: { value: 'targeted' } })

    expect(
      screen.getByText('Select at least one user or segment for targeted visibility.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Add segment' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add user' }))
    fireEvent.submit(screen.getByRole('button', { name: 'Create' }).closest('form')!)

    await waitFor(() => {
      expect(mocks.createCategory).toHaveBeenCalledWith({
        name: 'Billing',
        description: 'Account help',
        icon: 'SparklesIcon',
        isPublic: true,
        visibility: 'targeted',
        allowedSegmentIds: ['segment_vip'],
        allowedPrincipalIds: ['principal_1'],
        parentId: 'cat_root',
      })
    })
    expect(onCreated).toHaveBeenCalledWith('cat_created')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('edits existing categories, excludes descendants from parent choices and supports disabling', async () => {
    const onOpenChange = vi.fn()
    render(
      <CategoryFormDialog
        open
        onOpenChange={onOpenChange}
        initialValues={{
          id: 'cat_child' as never,
          name: 'Existing',
          description: 'Old description',
          icon: null,
          isPublic: true,
          visibility: 'public',
          allowedSegmentIds: [],
          allowedPrincipalIds: [],
          parentId: 'cat_root' as never,
        }}
      />
    )

    expect(screen.getByRole('heading', { name: 'Edit category' })).toBeInTheDocument()
    expect(screen.getByLabelText('Parent category')).toHaveTextContent('Root')
    expect(screen.queryByText('Child')).not.toBeInTheDocument()
    expect(screen.queryByText('Grandchild')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Updated  ' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '   ' } })
    fireEvent.change(screen.getByLabelText('Parent category'), { target: { value: '__none__' } })
    fireEvent.click(screen.getByLabelText('Enabled'))
    fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!)

    await waitFor(() => {
      expect(mocks.updateCategory).toHaveBeenCalledWith({
        id: 'cat_child',
        name: 'Updated',
        description: null,
        icon: 'FolderIcon',
        isPublic: false,
        visibility: 'public',
        allowedSegmentIds: [],
        allowedPrincipalIds: [],
        parentId: null,
      })
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
