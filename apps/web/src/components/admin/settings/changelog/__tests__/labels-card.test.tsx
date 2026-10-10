// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DragEndEvent } from '@dnd-kit/core'
import type { ChangelogCategory } from '@/lib/server/domains/changelog/changelog-category.types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createAutosaveMutationCache } from '@/lib/client/autosave'
import { LabelsCard } from '../labels-card'

function renderCard(initialCategories: ChangelogCategory[]) {
  const client = new QueryClient({ mutationCache: createAutosaveMutationCache() })
  return render(
    <QueryClientProvider client={client}>
      <LabelsCard initialCategories={initialCategories} />
    </QueryClientProvider>
  )
}

// Drag gestures need layout, which happy-dom lacks: capture the drag-end
// handler the card gives the DndContext and call it with a real event shape.
const dnd = vi.hoisted(() => ({ onDragEnd: null as ((event: DragEndEvent) => void) | null }))
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  return {
    ...actual,
    DndContext: (props: { onDragEnd?: (event: DragEndEvent) => void; children: never }) => {
      dnd.onDragEnd = props.onDragEnd ?? null
      return <actual.DndContext {...props} />
    },
  }
})

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: toastError } }))
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate: vi.fn() }) }))
vi.mock('@/lib/client/queries/changelog', () => ({
  changelogCategoryQueries: {
    segments: () => ({ queryKey: ['segs'], queryFn: async () => [] }),
  },
}))
const fns = vi.hoisted(() => ({
  reorder: vi.fn(),
  remove: vi.fn(),
}))
vi.mock('@/lib/server/functions/changelog-categories', () => ({
  createChangelogCategoryFn: vi.fn(),
  updateChangelogCategoryFn: vi.fn(),
  deleteChangelogCategoryFn: fns.remove,
  reorderChangelogCategoriesFn: fns.reorder,
}))
vi.mock('@/components/admin/segments/segment-multi-select', () => ({
  SegmentMultiSelect: () => null,
}))

const category = (id: string, name: string, color: string): ChangelogCategory =>
  ({ id, name, color, segmentIds: [] }) as unknown as ChangelogCategory

const LABELS = [
  category('cat_new', 'New', '#22c55e'),
  category('cat_improved', 'Improved', '#3b82f6'),
  category('cat_fixed', 'Fixed', '#ef4444'),
]

const rowNames = () =>
  Array.from(document.querySelectorAll('[data-slot="settings-list-row"]')).map((row) =>
    within(row as HTMLElement)
      .getByText(/^(New|Improved|Fixed)$/)
      .textContent?.trim()
  )

beforeEach(() => {
  dnd.onDragEnd = null
  fns.reorder.mockResolvedValue(undefined)
  fns.remove.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('LabelsCard', () => {
  it('shows the shared empty state and a New label button in the header', () => {
    renderCard([])
    expect(screen.getByText('No labels yet')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /New label/ })).toHaveLength(1)
    expect(screen.queryByText('Add new label')).toBeNull()
  })

  it('opens a Create label dialog', () => {
    renderCard([])
    fireEvent.click(screen.getByRole('button', { name: /New label/ }))
    expect(screen.getByRole('button', { name: 'Create label' })).toBeTruthy()
    expect(screen.queryByText('New category')).toBeNull()
  })

  it('renders each label as a list row with a colour dot and a row menu', () => {
    renderCard(LABELS)
    expect(rowNames()).toEqual(['New', 'Improved', 'Fixed'])
    expect(document.querySelectorAll('[data-slot="row-dot"]')).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Actions for Improved' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Move .* (up|down)/ })).toBeNull()
  })

  it('offers a drag handle per label', () => {
    renderCard(LABELS)
    expect(screen.getByRole('button', { name: 'Reorder Fixed' })).toBeTruthy()
  })

  it('sends the full new order when a label is dragged', async () => {
    renderCard(LABELS)
    dnd.onDragEnd?.({ active: { id: 'cat_fixed' }, over: { id: 'cat_new' } } as DragEndEvent)
    await waitFor(() => expect(fns.reorder).toHaveBeenCalledTimes(1))
    expect(fns.reorder).toHaveBeenCalledWith({
      data: { ids: ['cat_fixed', 'cat_new', 'cat_improved'] },
    })
    expect(rowNames()).toEqual(['Fixed', 'New', 'Improved'])
  })

  it('sends nothing when a label is dropped where it started', async () => {
    renderCard(LABELS)
    dnd.onDragEnd?.({ active: { id: 'cat_new' }, over: { id: 'cat_new' } } as DragEndEvent)
    dnd.onDragEnd?.({ active: { id: 'cat_new' }, over: null } as DragEndEvent)
    // A real drag after the no-op drops flushes the mutation queue: only it may reach the server.
    dnd.onDragEnd?.({ active: { id: 'cat_fixed' }, over: { id: 'cat_new' } } as DragEndEvent)
    await waitFor(() => expect(fns.reorder).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(fns.reorder).toHaveBeenCalledTimes(1)
    expect(fns.reorder).toHaveBeenCalledWith({
      data: { ids: ['cat_fixed', 'cat_new', 'cat_improved'] },
    })
  })

  it('restores the order and toasts once when the reorder fails', async () => {
    fns.reorder.mockRejectedValue(new Error('boom'))
    renderCard(LABELS)
    dnd.onDragEnd?.({ active: { id: 'cat_fixed' }, over: { id: 'cat_new' } } as DragEndEvent)
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    expect(rowNames()).toEqual(['New', 'Improved', 'Fixed'])
  })

  it('confirms before deleting from the row menu', async () => {
    renderCard(LABELS)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Actions for Improved' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    expect(fns.remove).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: 'Delete label' }))
    await waitFor(() => expect(fns.remove).toHaveBeenCalledWith({ data: { id: 'cat_improved' } }))
  })
})
