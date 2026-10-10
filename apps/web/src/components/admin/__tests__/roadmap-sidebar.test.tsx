// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/lib/client/hooks/use-roadmaps-query', () => ({
  useRoadmaps: () => ({ data: [], isLoading: false }),
}))
vi.mock('@/lib/client/hooks/use-segments-queries', () => ({ useSegments: () => ({ data: [] }) }))
vi.mock('@/lib/client/mutations', () => ({
  useCreateRoadmap: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useUpdateRoadmap: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useDeleteRoadmap: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))
vi.mock('../roadmap-builder-form', () => ({
  RoadmapBuilderForm: ({ submitLabel }: { submitLabel: string }) => <button>{submitLabel}</button>,
}))

const { RoadmapSidebar } = await import('../roadmap-sidebar')

afterEach(cleanup)

function renderSidebar() {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } })
  render(
    <QueryClientProvider client={client}>
      <RoadmapSidebar selectedRoadmapId={null} onSelectRoadmap={() => {}} />
    </QueryClientProvider>
  )
}

describe('RoadmapSidebar', () => {
  it('labels the add control New roadmap and opens the create dialog from it', async () => {
    renderSidebar()
    await userEvent.setup().click(screen.getByRole('button', { name: 'New roadmap' }))
    expect(screen.getByRole('heading', { name: 'Create roadmap' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create roadmap' })).toBeInTheDocument()
  })
})
