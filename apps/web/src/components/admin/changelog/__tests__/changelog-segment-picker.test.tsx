// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const SEGMENTS = [
  { id: 'segment_enterprise', name: 'Enterprise' },
  { id: 'segment_beta', name: 'Beta testers' },
]

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
import type { SegmentId } from '@quackback/ids'

afterEach(cleanup)

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

const baseProps = {
  publishState: { type: 'published' as const },
  onPublishStateChange: () => {},
  linkedPostIds: [],
  onLinkedPostsChange: () => {},
  categoryIds: [],
  onCategoriesChange: () => {},
  notify: true,
  onNotifyChange: () => {},
}

describe('<ChangelogMetadataSidebarContent> segment picker', () => {
  it('lists every segment and defaults to everyone (nothing selected)', async () => {
    hoisted.listSegmentsFn.mockResolvedValue(SEGMENTS)
    hoisted.searchShippedPostsFn.mockResolvedValue([])
    renderWithClient(<ChangelogMetadataSidebarContent {...baseProps} segmentIds={[]} />)

    await screen.findByText('Notify segments')
    expect(screen.getByText('Leave empty to notify every subscriber.')).toBeInTheDocument()
    for (const seg of SEGMENTS) {
      expect(screen.getByText(seg.name)).toBeInTheDocument()
    }
    const boxes = screen
      .getByRole('list', { name: 'Changelog notify segments' })
      .querySelectorAll('input[type="checkbox"]')
    expect(boxes).toHaveLength(SEGMENTS.length)
    for (const box of boxes) {
      expect((box as HTMLInputElement).checked).toBe(false)
    }
  })

  it('checking a segment reports the new selection through onSegmentIdsChange', async () => {
    hoisted.listSegmentsFn.mockResolvedValue(SEGMENTS)
    hoisted.searchShippedPostsFn.mockResolvedValue([])
    const onSegmentIdsChange = vi.fn()
    renderWithClient(
      <ChangelogMetadataSidebarContent
        {...baseProps}
        segmentIds={[]}
        onSegmentIdsChange={onSegmentIdsChange}
      />
    )

    const label = await screen.findByText('Enterprise')
    fireEvent.click(label.closest('label')!.querySelector('input[type="checkbox"]')!)
    expect(onSegmentIdsChange).toHaveBeenCalledWith(['segment_enterprise'])
  })

  it('reflects an existing selection (edit modal pre-fill)', async () => {
    hoisted.listSegmentsFn.mockResolvedValue(SEGMENTS)
    hoisted.searchShippedPostsFn.mockResolvedValue([])
    renderWithClient(
      <ChangelogMetadataSidebarContent {...baseProps} segmentIds={['segment_beta' as SegmentId]} />
    )

    const label = await screen.findByText('Beta testers')
    const box = label.closest('label')!.querySelector('input[type="checkbox"]')!
    await waitFor(() => expect((box as HTMLInputElement).checked).toBe(true))
  })

  it('hides the picker for drafts — a draft never notifies', async () => {
    hoisted.listSegmentsFn.mockResolvedValue(SEGMENTS)
    hoisted.searchShippedPostsFn.mockResolvedValue([])
    renderWithClient(
      <ChangelogMetadataSidebarContent
        {...baseProps}
        publishState={{ type: 'draft' }}
        segmentIds={[]}
      />
    )

    // Give the segments query a chance to resolve; the section must stay hidden.
    await waitFor(() => expect(hoisted.listSegmentsFn).toHaveBeenCalled())
    expect(screen.queryByText('Notify segments')).not.toBeInTheDocument()
  })

  it('hides the picker when the workspace has no segments', async () => {
    hoisted.listSegmentsFn.mockResolvedValue([])
    hoisted.searchShippedPostsFn.mockResolvedValue([])
    renderWithClient(<ChangelogMetadataSidebarContent {...baseProps} segmentIds={[]} />)

    await waitFor(() => expect(hoisted.listSegmentsFn).toHaveBeenCalled())
    expect(screen.queryByText('Notify segments')).not.toBeInTheDocument()
  })
})
