// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ChangelogId, PostId, PrincipalId } from '@quackback/ids'
import { CreateChangelogDialog } from '../create-changelog-dialog'
import { ChangelogModal } from '../changelog-modal'
import { ChangelogListItem } from '../changelog-list-item'
import { ChangelogMetadataSidebar } from '../changelog-metadata-sidebar'
import { ChangelogMetadataSidebarContent } from '../changelog-metadata-sidebar-content'

type ShippedPost = {
  id: PostId
  title: string
  voteCount: number
  boardSlug: string
  authorName: string | null
  createdAt: string
}

const pickedDate = new Date('2026-06-22T09:30:00.000Z')

const mocks = vi.hoisted(() => ({
  posts: [] as ShippedPost[],
  taxonomy: {
    categories: [
      { id: 'cat_1', name: 'Feature' },
      { id: 'cat_2', name: 'Fixes' },
    ],
    products: [
      { id: 'prod_1', name: 'Core app' },
      { id: 'prod_2', name: 'Widget' },
    ],
  },
  detailQuery: {
    data: null as null | {
      id: ChangelogId
      title: string
      content: string
      contentJson: unknown
      linkedPosts: Array<{ id: PostId; title: string; voteCount: number }>
      category: { name: string } | null
      product: { name: string } | null
      status: 'draft' | 'scheduled' | 'published'
      publishedAt: string | null
      author: { name: string | null } | null
    },
    isLoading: false,
  },
  createMutation: {
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: new Error('create failed'),
  },
  updateMutation: {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: new Error('update failed'),
  },
  closeUrlModal: vi.fn(),
  openCreateDialog: null as null | ((open: boolean) => void),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey?: readonly unknown[] }) => {
    if (options.queryKey?.[0] === 'changelog-taxonomy') {
      return { data: mocks.taxonomy }
    }
    if (options.queryKey?.[0] === 'changelog-detail') {
      return mocks.detailQuery
    }
    return { data: mocks.posts, isLoading: false }
  },
}))

vi.mock('@/lib/client/queries/changelog', () => ({
  changelogQueries: {
    detail: (id: ChangelogId) => ({ queryKey: ['changelog-detail', id] }),
    taxonomy: () => ({ queryKey: ['changelog-taxonomy'] }),
  },
}))

vi.mock('@/lib/client/mutations/changelog', () => ({
  useCreateChangelog: () => mocks.createMutation,
  useUpdateChangelog: () => mocks.updateMutation,
}))

vi.mock('@hookform/resolvers/standard-schema', () => ({
  standardSchemaResolver: () => async (values: Record<string, unknown>) => ({
    values,
    errors: {},
  }),
}))

vi.mock('@/lib/client/hooks/use-keyboard-submit', () => ({
  useKeyboardSubmit:
    (submit: () => void) => (event: { key?: string; metaKey?: boolean; ctrlKey?: boolean }) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        submit()
      }
    },
}))

vi.mock('@/lib/client/hooks/use-url-modal', () => ({
  useUrlModal: ({ urlId }: { urlId?: ChangelogId }) => ({
    open: Boolean(urlId),
    validatedId: urlId,
    close: mocks.closeUrlModal,
  }),
}))

vi.mock('@/routes/admin/changelog', () => ({
  Route: {
    useSearch: () => ({}),
  },
}))

vi.mock('@/components/shared/modal-footer', () => ({
  ModalFooter: ({
    children,
    onCancel,
    submitLabel,
    isPending,
  }: {
    children?: ReactNode
    onCancel: () => void
    submitLabel: string
    isPending?: boolean
  }) => (
    <footer>
      {children}
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
      <button type="submit" disabled={isPending}>
        {submitLabel}
      </button>
    </footer>
  ),
}))

vi.mock('@/components/shared/modal-header', () => ({
  ModalHeader: ({
    section,
    title,
    viewUrl,
    onClose,
  }: {
    section: string
    title: string
    viewUrl: string | null
    onClose: () => void
  }) => (
    <header>
      <span>{section}</span>
      <h1>{title}</h1>
      {viewUrl && <a href={viewUrl}>View entry</a>}
      <button type="button" onClick={onClose}>
        Close
      </button>
    </header>
  ),
}))

vi.mock('@/components/shared/url-modal-shell', () => ({
  UrlModalShell: ({
    children,
    open,
    hasValidId,
  }: {
    children: ReactNode
    open: boolean
    hasValidId: boolean
    onOpenChange?: (open: boolean) => void
    srTitle?: string
  }) => (open && hasValidId ? <section role="dialog">{children}</section> : null),
}))

vi.mock('@/components/ui/form', () => ({
  Form: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('../changelog-form-fields', () => ({
  ChangelogFormFields: ({
    form,
    onContentChange,
    error,
  }: {
    form: {
      watch: (field: string) => string
      setValue: (field: string, value: string, options?: { shouldValidate?: boolean }) => void
    }
    onContentChange: (json: unknown, html: string, markdown: string) => void
    error?: string
  }) => (
    <section>
      <label>
        Title
        <input
          aria-label="Title"
          value={form.watch('title') ?? ''}
          onChange={(event) => form.setValue('title', event.currentTarget.value)}
        />
      </label>
      <button
        type="button"
        onClick={() =>
          onContentChange(
            { type: 'doc', content: [{ type: 'paragraph' }] },
            '<p>Updated</p>',
            'Updated markdown'
          )
        }
      >
        Set content
      </button>
      {error && <p>{error}</p>}
    </section>
  ),
}))

vi.mock('@/components/ui/dialog', async () => {
  const React = await import('react')
  const DialogContext = React.createContext<{ open: boolean; setOpen: (open: boolean) => void }>({
    open: false,
    setOpen: () => {},
  })
  return {
    Dialog: ({
      children,
      open,
      onOpenChange,
    }: {
      children: ReactNode
      open?: boolean
      onOpenChange?: (open: boolean) => void
    }) => {
      const [internalOpen, setInternalOpen] = React.useState(open ?? false)
      const isOpen = open ?? internalOpen
      const setOpen = (nextOpen: boolean) => {
        if (open === undefined) {
          setInternalOpen(nextOpen)
          mocks.openCreateDialog = setInternalOpen
        }
        onOpenChange?.(nextOpen)
      }
      return (
        <DialogContext.Provider value={{ open: isOpen, setOpen }}>
          <div>{children}</div>
        </DialogContext.Provider>
      )
    },
    DialogContent: ({ children }: { children: ReactNode }) => {
      const context = React.useContext(DialogContext)
      return context.open ? (
        <section role="dialog">
          {children}
          <button type="button" onClick={() => context.setOpen(false)}>
            Close dialog
          </button>
        </section>
      ) : null
    },
    DialogTitle: ({ children }: { children: ReactNode; className?: string }) => <h2>{children}</h2>,
    DialogTrigger: ({ children }: { children: React.ReactElement; asChild?: boolean }) => {
      const context = React.useContext(DialogContext)
      return React.cloneElement(children as React.ReactElement<{ onClick?: () => void }>, {
        onClick: () => context.setOpen(true),
      })
    },
  }
})

vi.mock('@/components/ui/sheet', async () => {
  const React = await import('react')
  const SheetContext = React.createContext<{ open: boolean; setOpen: (open: boolean) => void }>({
    open: false,
    setOpen: () => {},
  })
  return {
    Sheet: ({
      children,
      open,
      onOpenChange,
    }: {
      children: ReactNode
      open?: boolean
      onOpenChange?: (open: boolean) => void
    }) => {
      const [internalOpen, setInternalOpen] = React.useState(open ?? false)
      const isOpen = open ?? internalOpen
      const setOpen = (nextOpen: boolean) => {
        if (open === undefined) {
          setInternalOpen(nextOpen)
        }
        onOpenChange?.(nextOpen)
      }
      return (
        <SheetContext.Provider value={{ open: isOpen, setOpen }}>
          <div>{children}</div>
        </SheetContext.Provider>
      )
    },
    SheetContent: ({ children }: { children: ReactNode }) => {
      const context = React.useContext(SheetContext)
      return context.open ? <section>{children}</section> : null
    },
    SheetHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
    SheetTitle: ({ children }: { children: ReactNode }) => <h3>{children}</h3>,
    SheetTrigger: ({ children }: { children: React.ReactElement; asChild?: boolean }) => {
      const context = React.useContext(SheetContext)
      return React.cloneElement(children as React.ReactElement<{ onClick?: () => void }>, {
        onClick: () => context.setOpen(true),
      })
    },
  }
})

vi.mock('@/lib/server/functions/changelog', () => ({
  searchShippedPostsFn: vi.fn(),
}))

vi.mock('@/components/ui/status-badge', () => ({
  StatusBadge: ({ name, color }: { name: string; color: string | null }) => (
    <span style={{ color: color ?? undefined }}>{name}</span>
  ),
}))

vi.mock('@/components/ui/time-ago', () => ({
  TimeAgo: ({ date }: { date: string; className?: string }) => <time>{date}</time>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
  }: {
    children: ReactNode
    onClick?: () => void
    variant?: string
    size?: string
    className?: string
    type?: 'button' | 'submit' | 'reset'
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode; align?: string }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: ReactNode
    onClick?: () => void
    className?: string
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children: ReactNode; asChild?: boolean }) => (
    <>{children}</>
  ),
}))

vi.mock('@/components/ui/popover', () => ({
  Popover: ({
    children,
  }: {
    children: ReactNode
    open?: boolean
    onOpenChange?: (open: boolean) => void
  }) => <div>{children}</div>,
  PopoverContent: ({
    children,
  }: {
    children: ReactNode
    className?: string
    align?: string
    sideOffset?: number
  }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode; asChild?: boolean }) => <>{children}</>,
}))

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: ReactNode; className?: string }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({ checked }: { checked?: boolean; className?: string }) => (
    <span>{checked ? 'checked' : 'unchecked'}</span>
  ),
}))

vi.mock('@/components/ui/datetime-picker', () => ({
  DateTimePicker: ({
    onChange,
  }: {
    value?: Date
    onChange?: (date: Date | undefined) => void
    minDate?: Date
    className?: string
  }) => (
    <button type="button" onClick={() => onChange?.(pickedDate)}>
      Pick date
    </button>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: ({
    value,
    onChange,
    placeholder,
    list,
  }: {
    value?: string
    onChange?: (event: { target: { value: string } }) => void
    placeholder?: string
    list?: string
    className?: string
  }) => (
    <input
      list={list}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange?.({ target: { value: event.currentTarget.value } })}
    />
  ),
}))

vi.mock('@/components/shared/sidebar-primitives', () => ({
  SidebarRow: ({
    label,
    children,
  }: {
    icon?: ReactNode
    label: string
    alignTop?: boolean
    children: ReactNode
  }) => (
    <section>
      <span>{label}</span>
      {children}
    </section>
  ),
  SidebarContainer: ({ children, className }: { children: ReactNode; className?: string }) => (
    <aside className={className}>{children}</aside>
  ),
  SidebarSkeleton: () => <div>sidebar skeleton</div>,
  StatusSelect: ({
    value,
    options,
    onChange,
  }: {
    value: string
    options: ReadonlyArray<{ value: string; label: string }>
    onChange: (value: string) => void
  }) => (
    <div data-value={value}>
      {options.map((option) => (
        <button key={option.value} type="button" onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  ),
  ListItem: ({
    title,
    meta,
    action,
    left,
  }: {
    left?: ReactNode
    title: string
    meta?: ReactNode[]
    action?: ReactNode
  }) => (
    <article>
      {left}
      <strong>{title}</strong>
      {meta}
      {action}
    </article>
  ),
  VoteCount: ({ count }: { count: number }) => <span>{count} votes</span>,
  ListItemRemoveButton: ({ onClick, label }: { onClick: () => void; label: string }) => (
    <button type="button" aria-label={label} onClick={onClick}>
      remove
    </button>
  ),
}))

vi.mock('@heroicons/react/24/outline', () => ({
  ChevronUpIcon: () => <span aria-hidden="true">up</span>,
  CubeIcon: () => <span aria-hidden="true">cube</span>,
  DocumentTextIcon: () => <span aria-hidden="true">doc</span>,
  EllipsisHorizontalIcon: () => <span aria-hidden="true">dots</span>,
  LinkIcon: () => <span aria-hidden="true">link</span>,
  MagnifyingGlassIcon: () => <span aria-hidden="true">search</span>,
  PencilIcon: () => <span aria-hidden="true">edit</span>,
  PlusIcon: () => <span aria-hidden="true">plus</span>,
  Squares2X2Icon: () => <span aria-hidden="true">category</span>,
  TrashIcon: () => <span aria-hidden="true">trash</span>,
  UserIcon: () => <span aria-hidden="true">user</span>,
}))

vi.mock('@heroicons/react/24/solid', () => ({
  CheckIcon: () => <span aria-hidden="true">check</span>,
  Cog6ToothIcon: () => <span aria-hidden="true">settings</span>,
  PlusIcon: () => <span aria-hidden="true">plus</span>,
}))

function post(overrides: Partial<ShippedPost> = {}): ShippedPost {
  return {
    id: 'post_1' as PostId,
    title: 'First shipped post',
    voteCount: 12,
    boardSlug: 'roadmap',
    authorName: 'Dana',
    createdAt: '2026-06-20T10:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.detailQuery = { data: null, isLoading: false }
  mocks.createMutation.isPending = false
  mocks.createMutation.isError = false
  mocks.createMutation.error = new Error('create failed')
  mocks.createMutation.mutate.mockImplementation(
    (_payload, options?: { onSuccess?: () => void }) => {
      options?.onSuccess?.()
    }
  )
  mocks.updateMutation.isPending = false
  mocks.updateMutation.isError = false
  mocks.updateMutation.error = new Error('update failed')
  mocks.updateMutation.mutate.mockImplementation(
    (_payload, options?: { onSuccess?: () => void }) => {
      options?.onSuccess?.()
    }
  )
  mocks.posts = [
    post(),
    post({
      id: 'post_2' as PostId,
      title: 'Second shipped post',
      voteCount: 3,
      boardSlug: 'ideas',
      authorName: null,
    }),
  ]
})

describe('ChangelogListItem', () => {
  it('renders a published entry with taxonomy, author, linked post count, and actions', () => {
    const onEdit = vi.fn()
    const onDelete = vi.fn()

    render(
      <ChangelogListItem
        id={'changelog_1' as ChangelogId}
        title="Launch notes"
        content="**Markdown** body with enough text for a preview"
        status="published"
        publishedAt="2026-06-20T09:00:00.000Z"
        createdAt="2026-06-19T09:00:00.000Z"
        author={{ id: 'principal_1' as PrincipalId, name: 'Ada', avatarUrl: null }}
        category={{ name: 'Feature', color: null }}
        product={{ name: 'Widget' }}
        linkedPosts={[{ id: 'post_1' as PostId, title: 'Post', voteCount: 4 }]}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    )

    expect(screen.getAllByText('Published')).toHaveLength(2)
    expect(screen.getByText('Feature')).toBeInTheDocument()
    expect(screen.getByText('Widget')).toBeInTheDocument()
    expect(screen.getByText('Launch notes')).toBeInTheDocument()
    expect(screen.getByText(/Markdown body/)).toBeInTheDocument()
    expect(screen.getByText('Ada')).toBeInTheDocument()
    expect(screen.getByText('2026-06-20T09:00:00.000Z')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Launch notes'))
    expect(onEdit).toHaveBeenCalledWith('changelog_1')

    fireEvent.click(screen.getByRole('button', { name: /Delete/ }))
    expect(onDelete).toHaveBeenCalledWith('changelog_1')
  })

  it('renders scheduled and draft time labels without optional metadata', () => {
    const { rerender } = render(
      <ChangelogListItem
        id={'changelog_2' as ChangelogId}
        title="Scheduled notes"
        content=""
        status="scheduled"
        publishedAt="2026-06-23T14:45:00.000Z"
        createdAt="2026-06-19T09:00:00.000Z"
        author={null}
        category={null}
        product={null}
        linkedPosts={[]}
      />
    )

    expect(screen.getByText('Scheduled')).toBeInTheDocument()
    expect(screen.getByText(/Scheduled for/)).toBeInTheDocument()

    rerender(
      <ChangelogListItem
        id={'changelog_3' as ChangelogId}
        title="Draft notes"
        content="Draft body"
        status="draft"
        publishedAt={null}
        createdAt="2026-06-18T09:00:00.000Z"
        author={null}
        category={null}
        product={null}
        linkedPosts={[]}
      />
    )

    expect(screen.getByText('Draft')).toBeInTheDocument()
    expect(screen.getByText('2026-06-18T09:00:00.000Z')).toBeInTheDocument()
  })
})

describe('ChangelogMetadataSidebarContent', () => {
  it('updates status, schedule, taxonomy fields, and linked posts', () => {
    const onPublishStateChange = vi.fn()
    const onLinkedPostsChange = vi.fn()
    const onCategoryNameChange = vi.fn()
    const onProductNameChange = vi.fn()

    render(
      <ChangelogMetadataSidebarContent
        publishState={{ type: 'scheduled', publishAt: new Date('2026-06-21T09:00:00.000Z') }}
        onPublishStateChange={onPublishStateChange}
        linkedPostIds={['post_1' as PostId]}
        onLinkedPostsChange={onLinkedPostsChange}
        categoryName="Feature"
        onCategoryNameChange={onCategoryNameChange}
        productName="Core app"
        onProductNameChange={onProductNameChange}
        authorName="Ada"
      />
    )

    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByText('Author')).toBeInTheDocument()
    expect(screen.getByText('Ada')).toBeInTheDocument()
    expect(screen.getByText('Schedule')).toBeInTheDocument()
    expect(screen.getAllByText('First shipped post')).toHaveLength(2)
    expect(screen.getByText('12 votes')).toBeInTheDocument()
    expect(screen.getByText('Dana')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Feature')).toHaveAttribute(
      'list',
      'changelog-category-options'
    )
    expect(screen.getByDisplayValue('Core app')).toHaveAttribute(
      'list',
      'changelog-product-options'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Draft' }))
    expect(onPublishStateChange).toHaveBeenCalledWith({ type: 'draft' })

    fireEvent.click(screen.getByRole('button', { name: 'Published' }))
    expect(onPublishStateChange).toHaveBeenCalledWith({ type: 'published' })

    fireEvent.click(screen.getByRole('button', { name: 'Pick date' }))
    expect(onPublishStateChange).toHaveBeenCalledWith({
      type: 'scheduled',
      publishAt: pickedDate,
    })

    fireEvent.change(screen.getByDisplayValue('Feature'), { target: { value: 'Fixes' } })
    expect(onCategoryNameChange).toHaveBeenCalledWith('Fixes')

    fireEvent.change(screen.getByDisplayValue('Core app'), { target: { value: 'Widget' } })
    expect(onProductNameChange).toHaveBeenCalledWith('Widget')

    fireEvent.click(screen.getByText('Second shipped post'))
    expect(onLinkedPostsChange).toHaveBeenCalledWith(['post_1', 'post_2'])

    fireEvent.click(screen.getByRole('button', { name: 'Remove First shipped post' }))
    expect(onLinkedPostsChange).toHaveBeenCalledWith([])
  })

  it('shows empty and search-empty post states', () => {
    mocks.posts = []
    const props = {
      publishState: { type: 'draft' as const },
      onPublishStateChange: vi.fn(),
      linkedPostIds: [] as PostId[],
      onLinkedPostsChange: vi.fn(),
      categoryName: '',
      onCategoryNameChange: vi.fn(),
      productName: '',
      onProductNameChange: vi.fn(),
    }

    render(<ChangelogMetadataSidebarContent {...props} />)

    expect(screen.getByText('No shipped posts yet.')).toBeInTheDocument()
    expect(screen.getByText('No posts linked yet')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Search shipped posts...'), {
      target: { value: 'missing' },
    })

    expect(screen.getByText('No shipped posts found.')).toBeInTheDocument()
  })
})

describe('ChangelogMetadataSidebar', () => {
  it('wraps metadata content in the shared sidebar container', () => {
    render(
      <ChangelogMetadataSidebar
        publishState={{ type: 'draft' }}
        onPublishStateChange={vi.fn()}
        linkedPostIds={[]}
        onLinkedPostsChange={vi.fn()}
        categoryName=""
        onCategoryNameChange={vi.fn()}
        productName=""
        onProductNameChange={vi.fn()}
        authorName="Ada"
      />
    )

    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByText('Author')).toBeInTheDocument()
    expect(screen.getByText('Ada')).toBeInTheDocument()
    expect(screen.getByText('No posts linked yet')).toBeInTheDocument()
  })
})

describe('CreateChangelogDialog', () => {
  it('creates a published changelog, resets local state, and calls the completion hook', async () => {
    const onChangelogCreated = vi.fn()
    render(<CreateChangelogDialog onChangelogCreated={onChangelogCreated} />)

    fireEvent.click(screen.getByRole('button', { name: /New Entry/ }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Fresh launch' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set content' }))
    fireEvent.click(screen.getByRole('button', { name: 'Published' }))
    fireEvent.change(screen.getByPlaceholderText('Feature'), { target: { value: 'Launches' } })
    fireEvent.change(screen.getByPlaceholderText('Core app'), { target: { value: 'Widget' } })
    fireEvent.click(screen.getByText('Second shipped post'))
    fireEvent.click(screen.getByRole('button', { name: 'Publish Now' }))

    await waitFor(() => {
      expect(mocks.createMutation.mutate).toHaveBeenCalledWith(
        {
          title: 'Fresh launch',
          content: 'Updated markdown',
          contentJson: { type: 'doc', content: [{ type: 'paragraph' }] },
          categoryName: 'Launches',
          productName: 'Widget',
          linkedPostIds: ['post_2'],
          publishState: expect.objectContaining({ type: 'published' }),
        },
        expect.objectContaining({ onSuccess: expect.any(Function) })
      )
    })
    expect(onChangelogCreated).toHaveBeenCalled()
    expect(mocks.createMutation.reset).not.toHaveBeenCalled()
  })

  it('shows pending and error states, then resets mutation state when closed', () => {
    mocks.createMutation.isPending = true
    mocks.createMutation.isError = true
    mocks.createMutation.error = new Error('Unable to create')

    render(<CreateChangelogDialog />)

    fireEvent.click(screen.getByRole('button', { name: /New Entry/ }))
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled()
    expect(screen.getByText('Unable to create')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
    expect(mocks.createMutation.reset).toHaveBeenCalled()
  })
})

describe('ChangelogModal', () => {
  it('initializes fetched data, updates content, and closes after saving', async () => {
    mocks.detailQuery = {
      data: {
        id: 'changelog_1' as ChangelogId,
        title: 'Existing release',
        content: 'Saved markdown',
        contentJson: { type: 'doc' },
        linkedPosts: [{ id: 'post_1' as PostId, title: 'First shipped post', voteCount: 12 }],
        category: { name: 'Feature' },
        product: { name: 'Core app' },
        status: 'published',
        publishedAt: '2026-06-20T09:00:00.000Z',
        author: { name: 'Ada' },
      },
      isLoading: false,
    }

    render(<ChangelogModal entryId="changelog_1" />)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByDisplayValue('Existing release')).toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: 'View entry' })).toHaveAttribute(
      'href',
      '/changelog/changelog_1'
    )

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Updated release' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set content' }))
    fireEvent.click(screen.getByRole('button', { name: 'Update & Publish' }))

    await waitFor(() => {
      expect(mocks.updateMutation.mutate).toHaveBeenCalledWith(
        {
          id: 'changelog_1',
          title: 'Updated release',
          content: 'Updated markdown',
          contentJson: { type: 'doc', content: [{ type: 'paragraph' }] },
          categoryName: 'Feature',
          productName: 'Core app',
          linkedPostIds: ['post_1'],
          publishState: expect.objectContaining({ type: 'published' }),
        },
        expect.objectContaining({ onSuccess: expect.any(Function) })
      )
    })
    expect(mocks.closeUrlModal).toHaveBeenCalled()
  })

  it('renders the loading state and hides content for invalid modal ids', () => {
    mocks.detailQuery = { data: null, isLoading: true }
    const { rerender } = render(<ChangelogModal entryId="changelog_1" />)

    expect(document.querySelector('.animate-spin')).toBeTruthy()

    rerender(<ChangelogModal entryId={undefined} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
