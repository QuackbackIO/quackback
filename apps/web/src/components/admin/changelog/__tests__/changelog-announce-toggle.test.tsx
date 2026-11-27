// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/lib/server/functions/admin', () => ({
  listSegmentsFn: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/server/functions/changelog', () => ({
  searchShippedPostsFn: vi.fn().mockResolvedValue([]),
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

afterEach(cleanup)

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

const baseProps = {
  publishState: { type: 'draft' as const },
  onPublishStateChange: () => {},
  linkedPostIds: [],
  onLinkedPostsChange: () => {},
  categoryIds: [],
  onCategoriesChange: () => {},
  notify: true,
  onNotifyChange: () => {},
}

const LABEL = 'Announce above the launcher'

describe('<ChangelogMetadataSidebarContent> announce above the launcher', () => {
  it('shows nothing while the workspace does not announce updates there', () => {
    renderWithClient(
      <ChangelogMetadataSidebarContent
        {...baseProps}
        workspaceAnnounces={false}
        announceOnLauncher={true}
      />
    )
    expect(screen.queryByText(LABEL)).not.toBeInTheDocument()
  })

  it('shows the entry choice when the workspace announces updates', () => {
    renderWithClient(
      <ChangelogMetadataSidebarContent
        {...baseProps}
        workspaceAnnounces={true}
        announceOnLauncher={false}
      />
    )
    const box = screen.getByRole('checkbox', { name: LABEL })
    expect(box).toHaveAttribute('aria-checked', 'false')
  })

  it('reports a change through onAnnounceOnLauncherChange', () => {
    const onChange = vi.fn()
    renderWithClient(
      <ChangelogMetadataSidebarContent
        {...baseProps}
        workspaceAnnounces={true}
        announceOnLauncher={true}
        onAnnounceOnLauncherChange={onChange}
      />
    )
    fireEvent.click(screen.getByRole('checkbox', { name: LABEL }))
    expect(onChange).toHaveBeenCalledWith(false)
  })
})
