// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HelpCenterList } from '../help-center-list'

type TreeCategoryFixture = {
  id: string
  name: string
  description: string | null
  icon: string | null
  isPublic: boolean
  visibility: 'public' | 'segments'
  allowedSegmentIds: string[]
  allowedPrincipalIds: string[]
  parentId: string | null
  articleCount: number
}

const parentCategory: TreeCategoryFixture = {
  id: 'cat_parent',
  name: 'Parent',
  description: 'Parent category',
  icon: 'book',
  isPublic: true,
  visibility: 'public',
  allowedSegmentIds: [],
  allowedPrincipalIds: [],
  parentId: null,
  articleCount: 2,
}

const childCategory: TreeCategoryFixture = {
  id: 'cat_child',
  name: 'Child',
  description: null,
  icon: null,
  isPublic: false,
  visibility: 'segments',
  allowedSegmentIds: ['segment_1'],
  allowedPrincipalIds: ['principal_1'],
  parentId: 'cat_parent',
  articleCount: 3,
}

const emptyCategory: TreeCategoryFixture = {
  id: 'cat_empty',
  name: 'Empty',
  description: null,
  icon: null,
  isPublic: true,
  visibility: 'public',
  allowedSegmentIds: [],
  allowedPrincipalIds: [],
  parentId: null,
  articleCount: 0,
}

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  setFilters: vi.fn(),
  filters: {
    status: 'all',
    category: 'cat_parent',
    showDeleted: false,
  } as {
    status: string
    category?: string
    showDeleted?: boolean
  },
  deleteArticleMutation: {
    isPending: false,
    mutate: vi.fn(),
  },
  deleteCategoryMutation: {
    isPending: false,
    mutateAsync: vi.fn(),
  },
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [parentCategory, childCategory, emptyCategory] }),
}))

vi.mock('@/routes/admin/help-center', () => ({
  Route: {
    fullPath: '/admin/help-center',
  },
}))

vi.mock('@/lib/client/queries/help-center', () => ({
  helpCenterQueries: {
    categories: () => ({ queryKey: ['help-center', 'categories'] }),
  },
}))

vi.mock('../use-help-center-filters', () => ({
  useHelpCenterFilters: () => ({
    filters: mocks.filters,
    setFilters: mocks.setFilters,
    hasActiveFilters: true,
  }),
}))

vi.mock('@/lib/client/mutations/help-center', () => ({
  useDeleteArticle: () => mocks.deleteArticleMutation,
  useDeleteCategory: () => mocks.deleteCategoryMutation,
}))

vi.mock('@/components/admin/feedback/inbox-layout', () => ({
  InboxLayout: ({
    headerTitle,
    filters,
    children,
    hasActiveFilters,
  }: {
    headerIcon: unknown
    headerTitle: string
    filters: ReactNode
    children: ReactNode
    hasActiveFilters: boolean
  }) => (
    <main data-active={hasActiveFilters}>
      <h1>{headerTitle}</h1>
      {filters}
      {children}
    </main>
  ),
}))

vi.mock('@/components/shared/confirm-dialog', () => ({
  ConfirmDialog: ({
    open,
    title,
    description,
    confirmLabel,
    onConfirm,
    onOpenChange,
  }: {
    open: boolean
    title: string
    description: ReactNode
    confirmLabel: string
    variant?: string
    isPending?: boolean
    onConfirm: () => void | Promise<void>
    onOpenChange: (open: boolean) => void
  }) =>
    open ? (
      <section role="alertdialog">
        <h2>{title}</h2>
        <p>{description}</p>
        <button type="button" onClick={() => void onConfirm()}>
          {confirmLabel}
        </button>
        <button type="button" onClick={() => onOpenChange(false)}>
          Close confirm
        </button>
      </section>
    ) : null,
}))

vi.mock('../help-center-filters', () => ({
  HelpCenterFiltersPanel: ({
    status,
    selectedCategoryId,
    showDeleted,
    onStatusChange,
    onSelectCategory,
    onShowDeletedChange,
    categoryActions,
  }: {
    status: string
    selectedCategoryId?: string
    showDeleted?: boolean
    onStatusChange: (status: string) => void
    onSelectCategory: (id: string | null) => void
    onShowDeletedChange: (showDeleted: boolean | undefined) => void
    categoryActions: {
      onNew: (parentId: string | null) => void
      onEdit: (category: TreeCategoryFixture) => void
      onDelete: (category: TreeCategoryFixture) => void
    }
  }) => (
    <aside>
      <span>
        Filters {status} {selectedCategoryId} {String(showDeleted)}
      </span>
      <button type="button" onClick={() => onStatusChange('published')}>
        Published status
      </button>
      <button type="button" onClick={() => onSelectCategory(null)}>
        Clear category
      </button>
      <button type="button" onClick={() => onShowDeletedChange(true)}>
        Show deleted
      </button>
      <button type="button" onClick={() => categoryActions.onNew(null)}>
        New root category
      </button>
      <button type="button" onClick={() => categoryActions.onNew('cat_parent')}>
        New child category
      </button>
      <button type="button" onClick={() => categoryActions.onEdit(childCategory)}>
        Edit child category
      </button>
      <button type="button" onClick={() => categoryActions.onDelete(parentCategory)}>
        Delete parent category
      </button>
      <button type="button" onClick={() => categoryActions.onDelete(emptyCategory)}>
        Delete empty category
      </button>
    </aside>
  ),
}))

vi.mock('../help-center-finder', () => ({
  HelpCenterFinder: ({
    onEditArticle,
    onDeleteArticle,
    categoryActions,
  }: {
    onEditArticle: (id: string) => void
    onDeleteArticle: (id: string) => void
    categoryActions: {
      onNew: (parentId: string | null) => void
      onEdit: (category: TreeCategoryFixture) => void
      onDelete: (category: TreeCategoryFixture) => void
    }
  }) => (
    <section>
      <button type="button" onClick={() => onEditArticle('article_1')}>
        Edit article
      </button>
      <button type="button" onClick={() => onDeleteArticle('article_1')}>
        Delete article
      </button>
      <button type="button" onClick={() => categoryActions.onNew(null)}>
        Finder new category
      </button>
    </section>
  ),
}))

vi.mock('../category-form-dialog', () => ({
  CategoryFormDialog: ({
    open,
    initialValues,
    defaultParentId,
    onOpenChange,
  }: {
    open: boolean
    initialValues?: TreeCategoryFixture
    defaultParentId?: string | null
    onOpenChange: (open: boolean) => void
  }) =>
    open ? (
      <section role="dialog">
        <span>Category dialog</span>
        <span>Initial {initialValues?.name ?? 'none'}</span>
        <span>Default parent {defaultParentId ?? 'none'}</span>
        <span>Visibility {initialValues?.visibility ?? 'none'}</span>
        <button type="button" onClick={() => onOpenChange(false)}>
          Close category
        </button>
      </section>
    ) : null,
}))

vi.mock('@heroicons/react/24/solid', () => ({
  BookOpenIcon: () => <span aria-hidden="true">book</span>,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.filters = {
    status: 'all',
    category: 'cat_parent',
    showDeleted: false,
  }
  mocks.deleteArticleMutation.isPending = false
  mocks.deleteArticleMutation.mutate.mockImplementation(
    (_articleId, options?: { onSuccess?: () => void }) => {
      options?.onSuccess?.()
    }
  )
  mocks.deleteCategoryMutation.isPending = false
  mocks.deleteCategoryMutation.mutateAsync.mockResolvedValue(undefined)
})

describe('HelpCenterList', () => {
  it('wires article actions, filter updates, and category form modes', () => {
    render(<HelpCenterList />)

    expect(screen.getByText('Help Center')).toBeInTheDocument()
    expect(screen.getByText(/Filters all cat_parent false/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Published status' }))
    expect(mocks.setFilters).toHaveBeenCalledWith({ status: 'published' })

    fireEvent.click(screen.getByRole('button', { name: 'Clear category' }))
    expect(mocks.setFilters).toHaveBeenCalledWith({ category: undefined })

    fireEvent.click(screen.getByRole('button', { name: 'Show deleted' }))
    expect(mocks.setFilters).toHaveBeenCalledWith({ showDeleted: true })

    fireEvent.click(screen.getByRole('button', { name: 'Edit article' }))
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/admin/help-center/articles/$articleId',
      params: { articleId: 'article_1' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'New child category' }))
    expect(screen.getByText('Category dialog')).toBeInTheDocument()
    expect(screen.getByText('Default parent cat_parent')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close category' }))
    expect(screen.queryByText('Category dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Edit child category' }))
    expect(screen.getByText('Initial Child')).toBeInTheDocument()
    expect(screen.getByText('Visibility segments')).toBeInTheDocument()
  })

  it('confirms article deletion and category cascade deletion', async () => {
    render(<HelpCenterList />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete article' }))
    expect(screen.getByRole('heading', { name: 'Delete help article?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(mocks.deleteArticleMutation.mutate).toHaveBeenCalledWith(
      'article_1',
      expect.objectContaining({ onSuccess: expect.any(Function) })
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete parent category' }))
    expect(screen.getByRole('heading', { name: 'Delete "Parent"?' })).toBeInTheDocument()
    expect(screen.getByText(/1 sub-category and 5 articles/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(mocks.deleteCategoryMutation.mutateAsync).toHaveBeenCalledWith('cat_parent')
    })
    expect(mocks.setFilters).toHaveBeenCalledWith({ category: undefined })
  })

  it('describes empty category deletion without cascade impact', () => {
    render(<HelpCenterList />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete empty category' }))

    expect(screen.getByRole('heading', { name: 'Delete "Empty"?' })).toBeInTheDocument()
    expect(screen.getByText(/This will permanently delete "Empty"/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close confirm' }))
    expect(screen.queryByRole('heading', { name: 'Delete "Empty"?' })).not.toBeInTheDocument()
  })
})
