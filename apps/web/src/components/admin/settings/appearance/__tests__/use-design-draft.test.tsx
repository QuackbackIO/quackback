// @vitest-environment happy-dom
/**
 * The Appearance draft saves itself shortly after each change, counts what it
 * changes against what visitors see now, and reports a refused publish.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { defaultDesign } from '@/lib/shared/design/schema'

const server = vi.hoisted(() => ({
  saves: [] as unknown[],
  /** Holds each save open until released, when set. */
  hold: null as Promise<void> | null,
  publishResult: { ok: true, revisionId: 'portal_design_revision_1', number: 1 } as unknown,
}))

vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate: async () => {} }) }))
vi.mock('@/lib/server/functions/portal-design', () => ({
  getPortalDesignFn: async () => editorState(),
  listPortalDesignVersionsFn: async () => [],
  savePortalDesignDraftFn: async ({ data }: { data: { design: unknown } }) => {
    server.saves.push(data.design)
    if (server.hold) await server.hold
    return { ok: true, report: { adjustments: [], errors: [], css: [] } }
  },
  discardPortalDesignDraftFn: async () => ({ ok: true }),
  publishPortalDesignFn: async () => server.publishResult,
  restorePortalDesignVersionFn: async () => ({ ok: true }),
}))

const { useDesignDraft, DRAFT_SAVE_DELAY_MS } = await import('../use-design-draft')
const { portalDesignQueries } = await import('@/lib/client/queries/portal-design')

function editorState() {
  return {
    design: defaultDesign(),
    live: defaultDesign(),
    source: 'converted' as const,
    published: null,
    report: { adjustments: [], errors: [], css: [] },
    revision: 'rev1',
  }
}

function setup() {
  const client = new QueryClient()
  client.setQueryData(portalDesignQueries.editor().queryKey, editorState())
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return renderHook(() => useDesignDraft(), { wrapper })
}

beforeEach(() => {
  server.saves = []
  server.publishResult = { ok: true, revisionId: 'portal_design_revision_1', number: 1 }
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useDesignDraft', () => {
  it('saves the draft once, after the changes settle', async () => {
    vi.useFakeTimers()
    const { result } = setup()
    act(() => result.current.update((draft) => void (draft.layout.density = 'compact')))
    act(() => result.current.update((draft) => void (draft.layout.width = 'wide')))
    expect(server.saves).toEqual([])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS)
    })
    expect(server.saves).toHaveLength(1)
    expect(server.saves[0]).toMatchObject({ layout: { density: 'compact', width: 'wide' } })
  })

  it('counts each change against what visitors see now', () => {
    const { result } = setup()
    expect(result.current.changes).toEqual([])
    act(() => result.current.update((draft) => void (draft.brand.light.accent = '#0f766e')))
    expect(result.current.changes.map((c) => c.path)).toEqual(['brand.light.accent'])
    expect(result.current.preview.css).toContain('--qb-accent: #0f766e;')
  })

  it('reports a refused publish', async () => {
    server.publishResult = {
      ok: false,
      code: 'DESIGN_CHANGED',
      message: 'Another version was published.',
    }
    const { result } = setup()
    let outcome: unknown
    await act(async () => {
      outcome = await result.current.publish()
    })
    expect(outcome).toEqual({ ok: false, message: 'Another version was published.' })
  })

  it('waits for a save already under way before the server reads the draft', async () => {
    vi.useFakeTimers()
    let release!: () => void
    server.hold = new Promise((resolve) => (release = resolve))
    const { result } = setup()
    act(() => result.current.update((draft) => void (draft.layout.density = 'compact')))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS)
    })
    expect(server.saves).toHaveLength(1)
    let flushed = false
    const flushing = result.current.flush().then(() => (flushed = true))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(flushed).toBe(false)
    release()
    await act(async () => {
      await flushing
    })
    expect(flushed).toBe(true)
    // It waited for that save rather than starting another.
    expect(server.saves).toHaveLength(1)
    server.hold = null
  })

  it('saves a pending change before publishing it', async () => {
    const { result } = setup()
    act(() => result.current.update((draft) => void (draft.layout.cards = 'list')))
    await act(async () => {
      await result.current.publish('List cards')
    })
    await waitFor(() => expect(server.saves).toHaveLength(1))
    expect(server.saves[0]).toMatchObject({ layout: { cards: 'list' } })
  })
})
