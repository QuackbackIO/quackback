// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PostId } from '@quackback/ids'

const hoisted = vi.hoisted(() => ({
  listSegmentsFn: vi.fn(),
  searchShippedPostsFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/admin', () => ({
  listSegmentsFn: hoisted.listSegmentsFn,
}))
vi.mock('@/lib/server/functions/changelog', () => ({
  searchShippedPostsFn: hoisted.searchShippedPostsFn,
}))
vi.mock('@/lib/client/queries/changelog', () => ({
  changelogSettingsQueries: {
    get: () => ({
      queryKey: ['changelog-settings'],
      queryFn: async () => ({ emailsDisabled: false }),
    }),
  },
  changelogCategoryQueries: {
    list: () => ({ queryKey: ['changelog-categories'], queryFn: async () => [] }),
  },
}))
vi.mock('@/lib/client/hooks/use-image-upload', () => ({
  useImageUpload: () => ({ upload: vi.fn() }),
}))

import { ChangelogMetadataSidebarContent } from '../changelog-metadata-sidebar-content'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

const baseProps = {
  publishState: { type: 'published' as const },
  onPublishStateChange: () => {},
  linkedPostIds: [] as PostId[],
  onLinkedPostsChange: () => {},
  categoryIds: [],
  onCategoriesChange: () => {},
  notify: true,
  onNotifyChange: () => {},
}

describe('<ChangelogMetadataSidebarContent> linked shipped posts', () => {
  it('requests limit 100 and forwards linkedPostIds as includeIds so linked cards always render', async () => {
    hoisted.listSegmentsFn.mockResolvedValue([])
    hoisted.searchShippedPostsFn.mockResolvedValue([
      {
        id: 'post_recent' as PostId,
        title: 'Newly shipped post',
        voteCount: 1,
        boardSlug: 'feature-requests',
        authorName: 'Alice',
        createdAt: new Date('2026-03-01T00:00:00Z'),
      },
      {
        id: 'post_linked_older' as PostId,
        title: 'Older linked post beyond initial limit',
        voteCount: 1,
        boardSlug: 'bugs',
        authorName: 'Bob',
        createdAt: new Date('2025-01-01T00:00:00Z'),
      },
    ])

    renderWithClient(
      <ChangelogMetadataSidebarContent
        {...baseProps}
        linkedPostIds={['post_linked_older' as PostId]}
      />
    )

    await waitFor(() =>
      expect(hoisted.searchShippedPostsFn).toHaveBeenCalledWith({
        data: {
          query: undefined,
          limit: 100,
          includeIds: ['post_linked_older'],
        },
      })
    )

    expect(await screen.findByText('Older linked post beyond initial limit')).toBeInTheDocument()
  })

  it('keeps linked post cards visible in the sidebar while filtering the +Add popover search', async () => {
    hoisted.listSegmentsFn.mockResolvedValue([])
    hoisted.searchShippedPostsFn.mockImplementation(
      async ({ data }: { data?: { query?: string; includeIds?: string[] } }) => {
        const all = [
          {
            id: 'post_match' as PostId,
            title: 'Dark mode support',
            voteCount: 10,
            boardSlug: 'feature-requests',
            authorName: 'Alice',
            createdAt: new Date('2026-03-01T00:00:00Z'),
          },
          {
            id: 'post_linked' as PostId,
            title: 'Already linked post',
            voteCount: 2,
            boardSlug: 'general',
            authorName: 'Bob',
            createdAt: new Date('2026-02-01T00:00:00Z'),
          },
        ]
        if (!data?.query) return all
        return all.filter(
          (p) =>
            p.title.toLowerCase().includes(data.query!.toLowerCase()) ||
            data.includeIds?.includes(p.id)
        )
      }
    )

    renderWithClient(
      <ChangelogMetadataSidebarContent {...baseProps} linkedPostIds={['post_linked' as PostId]} />
    )

    expect(await screen.findByText('Already linked post')).toBeInTheDocument()

    // Open the +Add popover and filter by "Dark mode"
    fireEvent.click(screen.getAllByRole('button', { name: /add/i }).at(-1)!)
    const searchInput = await screen.findByPlaceholderText('Search shipped posts...')
    fireEvent.change(searchInput, { target: { value: 'Dark mode' } })

    await waitFor(() =>
      expect(hoisted.searchShippedPostsFn).toHaveBeenCalledWith({
        data: {
          query: 'Dark mode',
          limit: 100,
          includeIds: ['post_linked'],
        },
      })
    )

    // Matching option is shown in the popover, and the already-linked card remains in the sidebar
    expect(await screen.findByText('Dark mode support')).toBeInTheDocument()
    expect(screen.getAllByText('Already linked post')).toHaveLength(1)
  })
})
