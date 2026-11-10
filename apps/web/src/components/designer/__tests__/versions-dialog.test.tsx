// @vitest-environment happy-dom
/**
 * Copy into draft replaces the draft, so the draft is saved aside on the
 * server first, for a published version and for a draft save alike.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { defaultDesign } from '@/lib/shared/design/schema'

vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate: async () => {} }) }))
vi.mock('@/lib/client/builder-events', () => ({ trackBuilder: vi.fn() }))
vi.mock('@/lib/server/functions/portal-design', () => ({
  getPortalDesignFn: vi.fn(),
  getPortalDesignSwitchFn: async () => ({ canSwitchBack: false, canPublish: true }),
  listPortalDesignVersionsFn: async () => [
    {
      id: 'portal_design_revision_1',
      number: 1,
      source: 'appearance',
      message: null,
      publishedBy: null,
      createdAt: new Date(),
    },
  ],
  getPortalDesignVersionFn: async () => ({ ok: true, design: defaultDesign(), number: 1 }),
  switchBackPortalDesignFn: vi.fn(),
}))
vi.mock('@/lib/server/functions/portal-design-ai', () => ({ getPortalDesignAiStatusFn: vi.fn() }))
vi.mock('@/lib/server/functions/portal-design-saved', () => ({
  listPortalDesignSavedFn: async () => ({
    checkpoints: [],
    looks: [],
    drafts: [
      {
        id: 'portal_design_saved_1',
        name: 'Before discard',
        createdAt: new Date().toISOString(),
        createdBy: null,
      },
    ],
  }),
  getPortalDesignCheckpointFn: async () => ({
    ok: true,
    design: defaultDesign(),
    name: 'Before discard',
  }),
}))

const { VersionsDialog } = await import('../versions-dialog')

afterEach(cleanup)

function mount() {
  const calls: string[] = []
  const draft = {
    published: { revisionId: 'portal_design_revision_1' as never, number: 1 },
    restore: vi.fn(),
    saveAside: vi.fn(async (cause: string) => void calls.push(`aside:${cause}`)),
    update: vi.fn((_change: unknown, label?: string) => {
      calls.push(`update:${label}`)
      return { ok: true as const }
    }),
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <VersionsDialog open onOpenChange={() => {}} draft={draft} />
    </QueryClientProvider>
  )
  return calls
}

describe('VersionsDialog', () => {
  it('saves the draft aside before copying a version into it', async () => {
    const calls = mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Copy version 1 into the draft' }))
    await waitFor(() => expect(calls).toEqual(['aside:copy', 'update:Copy of version 1']))
  })

  it('saves the draft aside before copying a draft save into it', async () => {
    const calls = mount()
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Copy draft save "Before discard" into the draft',
      })
    )
    await waitFor(() =>
      expect(calls).toEqual(['aside:copy', 'update:Copy of draft save: Before discard'])
    )
  })
})
