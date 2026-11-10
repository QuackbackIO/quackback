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
  /** The revision each save was made against. */
  revisions: [] as Array<string | undefined>,
  /** Results for the next saves, in order; a save without one succeeds. */
  results: [] as unknown[],
  /** The draft revision the server is at. */
  revision: 'rev1',
  /** Holds each save open until released, when set. */
  hold: null as Promise<void> | null,
  /** The revision each publish was asked against. */
  published: [] as Array<string | undefined>,
  workspaceLogo: [] as Array<boolean | undefined>,
  publishResult: { ok: true, revisionId: 'portal_design_revision_1', number: 1 } as unknown,
}))

vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate: async () => {} }) }))
vi.mock('@/lib/server/functions/portal-design', () => ({
  getPortalDesignFn: async () => editorState(),
  listPortalDesignVersionsFn: async () => [],
  savePortalDesignDraftFn: async ({ data }: { data: { design: unknown; revision?: string } }) => {
    server.saves.push(data.design)
    server.revisions.push(data.revision)
    if (server.hold) await server.hold
    const planned = server.results.shift()
    if (planned instanceof Error) throw planned
    if (planned) return planned
    server.revision = `rev${server.saves.length + 1}`
    return { ok: true, report: { adjustments: [], errors: [], css: [] }, revision: server.revision }
  },
  discardPortalDesignDraftFn: async () => ({ ok: true }),
  publishPortalDesignFn: async ({
    data,
  }: {
    data: { revision?: string; workspaceLogo?: boolean }
  }) => {
    server.published.push(data.revision)
    server.workspaceLogo.push(data.workspaceLogo)
    return server.publishResult
  },
  restorePortalDesignVersionFn: async () => ({ ok: true }),
}))

const { useDesignDraft, DRAFT_SAVE_DELAY_MS, UNDO_MERGE_MS, nameOfChange, designPreviewCss } =
  await import('../use-design-draft')
const { portalDesignQueries } = await import('@/lib/client/queries/portal-design')

function editorState() {
  return {
    design: defaultDesign(),
    live: defaultDesign(),
    source: 'converted' as const,
    published: null,
    report: { adjustments: [], errors: [], css: [] },
    revision: server.revision,
    authors: {},
    draftSavedAt: null,
    waiting: 0,
    canPublish: true,
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
  server.revisions = []
  server.results = []
  server.revision = 'rev1'
  server.published = []
  server.workspaceLogo = []
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
    // The preview frame takes the draft whole, and draws it with the server's code.
    expect(result.current.preview).toBe(result.current.design)
    expect(designPreviewCss(result.current.preview)).toContain('--qb-accent: #0f766e;')
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

  it('asks a publish to use the portal logo in the admin and emails only when told to', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.publish('Logo')
      await result.current.publish('Logo', { workspaceLogo: true })
    })
    expect(server.workspaceLogo).toEqual([false, true])
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

  describe('when someone else changes the draft', () => {
    const conflict = { ok: false, code: 'REVISION_MISMATCH', message: 'Changed elsewhere' }

    it('sends each save against the revision the last one returned', async () => {
      vi.useFakeTimers()
      const { result } = setup()
      act(() => result.current.update((draft) => void (draft.layout.density = 'compact')))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS)
      })
      act(() => result.current.update((draft) => void (draft.layout.width = 'wide')))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS)
      })
      expect(server.revisions).toEqual(['rev1', 'rev2'])
    })

    it('stops saving until the person chooses, and loading theirs takes their draft', async () => {
      vi.useFakeTimers()
      server.results = [conflict]
      const { result } = setup()
      act(() => result.current.update((draft) => void (draft.layout.density = 'compact')))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS)
      })
      expect(result.current.conflict).toBe(true)
      act(() => result.current.update((draft) => void (draft.layout.width = 'wide')))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS)
      })
      expect(server.saves).toHaveLength(1)
      server.revision = 'rev9'
      await act(async () => {
        await result.current.loadTheirs()
      })
      expect(result.current.conflict).toBe(false)
      expect(result.current.design.layout.width).not.toBe('wide')
    })

    it('says who changed the draft and when, until the person chooses', async () => {
      vi.useFakeTimers()
      const lastChange = { by: 'Sam', at: '2026-11-01T12:00:00.000Z', kind: 'saved' }
      server.results = [{ ...conflict, lastChange }]
      const { result } = setup()
      act(() => result.current.update((draft) => void (draft.layout.density = 'compact')))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS)
      })
      expect(result.current.conflictChange).toEqual(lastChange)
      await act(async () => {
        await result.current.loadTheirs()
      })
      expect(result.current.conflictChange).toBeNull()
    })

    it('keeping mine saves against the revision the server has now', async () => {
      vi.useFakeTimers()
      server.results = [conflict]
      const { result } = setup()
      act(() => result.current.update((draft) => void (draft.layout.density = 'compact')))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS)
      })
      server.revision = 'rev9'
      await act(async () => {
        await result.current.keepMine()
      })
      expect(result.current.conflict).toBe(false)
      expect(server.revisions).toEqual(['rev1', 'rev9'])
      expect(server.saves[1]).toMatchObject({ layout: { density: 'compact' } })
    })
  })

  describe('undo and redo', () => {
    it('takes a change back and puts it back, saving each', async () => {
      vi.useFakeTimers()
      const { result } = setup()
      act(() =>
        result.current.update((draft) => void (draft.layout.density = 'compact'), 'Spacing')
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(UNDO_MERGE_MS + DRAFT_SAVE_DELAY_MS)
      })
      act(() => result.current.update((draft) => void (draft.layout.width = 'wide'), 'Width'))
      expect(result.current.undoLabel).toBe('Width')
      act(() => result.current.undo())
      expect(result.current.design.layout.width).not.toBe('wide')
      expect(result.current.design.layout.density).toBe('compact')
      expect(result.current.redoLabel).toBe('Width')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS)
      })
      expect(server.saves.at(-1)).toMatchObject({ layout: { density: 'compact' } })
      act(() => result.current.redo())
      expect(result.current.design.layout.width).toBe('wide')
    })

    it('undoes a burst of the same change, such as typing, as one step', () => {
      vi.useFakeTimers()
      const { result } = setup()
      const before = result.current.design.layout.width
      act(() => result.current.update((draft) => void (draft.layout.width = 'wide'), 'Width'))
      act(() => result.current.update((draft) => void (draft.layout.width = 'narrow'), 'Width'))
      act(() => result.current.undo())
      expect(result.current.design.layout.width).toBe(before)
      expect(result.current.undoLabel).toBeNull()
    })

    it('takes back a group of changes, such as a drag, in one step under its name', () => {
      const { result } = setup()
      const original = structuredClone(result.current.design)
      act(() => result.current.begin('Move block'))
      act(() => result.current.update((draft) => void (draft.layout.width = 'wide'), 'Width'))
      act(() => result.current.update((draft) => void (draft.layout.density = 'compact')))
      act(() => result.current.end())
      expect(result.current.undoLabel).toBe('Move block')
      act(() => result.current.undo())
      expect(result.current.design).toEqual(original)
      expect(result.current.undoLabel).toBeNull()
    })

    it('takes back an AI change in one step, named for what it changed', () => {
      const { result } = setup()
      const ai = structuredClone(result.current.design)
      const original = structuredClone(result.current.design)
      ai.layout.width = 'wide'
      ai.layout.density = 'compact'
      act(() => result.current.adopt(ai))
      expect(result.current.undoLabel).toBe('Density and 1 more')
      act(() => result.current.undo())
      expect(result.current.design).toEqual(original)
    })

    it('makes a change by hand while the AI works its own undo step', () => {
      const { result } = setup()
      const original = structuredClone(result.current.design)
      act(() => result.current.begin('Make it calmer', 'ai'))
      const first = structuredClone(result.current.design)
      first.layout.width = 'wide'
      act(() => result.current.adopt(first, undefined, 'Make it calmer', 'r2'))
      act(() =>
        result.current.update((draft) => void (draft.layout.density = 'compact'), 'Density')
      )
      act(() => result.current.end('ai'))
      expect(result.current.undoLabel).toBe('Density')
      act(() => result.current.undo())
      expect(result.current.design.layout.density).toBe(original.layout.density)
      expect(result.current.design.layout.width).toBe('wide')
      expect(result.current.undoLabel).toBe('Make it calmer')
      act(() => result.current.undo())
      expect(result.current.design).toEqual(original)
    })

    it('starts again when another draft is loaded', async () => {
      const { result } = setup()
      act(() => result.current.update((draft) => void (draft.layout.width = 'wide'), 'Width'))
      await act(async () => {
        await result.current.loadTheirs()
      })
      expect(result.current.undoLabel).toBeNull()
    })
  })

  describe('keeping work safe', () => {
    it('keeps saving after a save fails to reach the server, and says so meanwhile', async () => {
      vi.useFakeTimers()
      const { result } = setup()
      server.results = [new Error('offline')]
      act(() => result.current.update((draft) => void (draft.layout.density = 'compact')))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS)
      })
      expect(result.current.failed).toBe(true)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(result.current.failed).toBe(false)
      expect(server.saves.at(-1)).toMatchObject({ layout: { density: 'compact' } })
      act(() => result.current.update((draft) => void (draft.layout.width = 'wide')))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS)
      })
      expect(server.saves.at(-1)).toMatchObject({ layout: { width: 'wide' } })
    })

    it('keeps a change made by hand while the AI worked, and saves both', async () => {
      vi.useFakeTimers()
      const { result } = setup()
      const original = structuredClone(result.current.design)
      // The person changes the density while the server works on the request.
      act(() =>
        result.current.update((draft) => void (draft.layout.density = 'compact'), 'Density')
      )
      // The server's design: the draft it read (before the hand change) and the AI's change.
      const ai = structuredClone(original)
      ai.layout.width = 'wide'
      act(() => result.current.adopt(ai, undefined, 'Wider', 'r2'))
      expect(result.current.design.layout).toMatchObject({ density: 'compact', width: 'wide' })
      // The hand change saves on top of the AI's, against the revision the AI's save returned.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS)
      })
      expect(server.saves.at(-1)).toMatchObject({ layout: { density: 'compact', width: 'wide' } })
      expect(server.revisions.at(-1)).toBe('r2')
      // Undo takes back the AI's change alone, then the hand change.
      expect(result.current.undoLabel).toBe('Wider')
      act(() => result.current.undo())
      expect(result.current.design.layout).toMatchObject({
        density: 'compact',
        width: original.layout.width,
      })
      act(() => result.current.undo())
      expect(result.current.design).toEqual(original)
    })

    it('keeps a hand change made during an AI step of the loop, inside its group', () => {
      const { result } = setup()
      const original = structuredClone(result.current.design)
      act(() => result.current.begin('Make it calmer', 'ai'))
      act(() =>
        result.current.update((draft) => void (draft.layout.density = 'compact'), 'Density')
      )
      const ai = structuredClone(original)
      ai.layout.width = 'wide'
      act(() => result.current.adopt(ai, undefined, 'Make it calmer', 'r2'))
      act(() => result.current.end('ai'))
      expect(result.current.design.layout).toMatchObject({ density: 'compact', width: 'wide' })
      expect(result.current.undoLabel).toBe('Make it calmer')
      act(() => result.current.undo())
      expect(result.current.design.layout).toMatchObject({
        density: 'compact',
        width: original.layout.width,
      })
    })

    it('lets the hand change win where it and the AI changed the same thing', () => {
      const { result } = setup()
      const original = structuredClone(result.current.design)
      act(() => result.current.update((draft) => void (draft.layout.width = 'narrow'), 'Width'))
      const ai = structuredClone(original)
      ai.layout.width = 'wide'
      ai.layout.density = 'compact'
      act(() => result.current.adopt(ai, undefined, 'Calmer', 'r2'))
      expect(result.current.design.layout).toMatchObject({ width: 'narrow', density: 'compact' })
      act(() => result.current.undo())
      expect(result.current.design.layout).toMatchObject({
        width: 'narrow',
        density: original.layout.density,
      })
    })

    it('takes the revision a server-side save returned, without asking again', async () => {
      const { result } = setup()
      const ai = structuredClone(result.current.design)
      ai.layout.width = 'wide'
      act(() => result.current.adopt(ai, undefined, 'Wider', 'rev9'))
      await act(async () => {
        await result.current.publish()
      })
      expect(server.published).toEqual(['rev9'])
    })

    it('publishes the draft as reviewed, and not while a conflict is open', async () => {
      const { result } = setup()
      server.results = [{ ok: false, code: 'REVISION_MISMATCH', message: 'moved' }]
      act(() => result.current.update((draft) => void (draft.layout.width = 'wide')))
      let outcome: unknown
      await act(async () => {
        outcome = await result.current.publish()
      })
      expect(outcome).toMatchObject({ ok: false, message: expect.stringContaining('Choose') })
      expect(server.published).toEqual([])
    })

    it('lets a picked choice count over an exact value, and one undo brings both back', () => {
      const { result } = setup()
      act(() => result.current.update((draft) => void (draft.tune = { headline: { size: 48 } })))
      act(() =>
        result.current.update((draft) => void (draft.brand.fonts.scale = 'display'), 'Size')
      )
      expect(result.current.design.tune).toBeUndefined()
      act(() => result.current.undo())
      expect(result.current.design.tune).toEqual({ headline: { size: 48 } })
    })

    it('brings a discarded draft back with undo', async () => {
      const { result } = setup()
      act(() => result.current.update((draft) => void (draft.layout.width = 'wide')))
      await act(async () => {
        await result.current.discard()
      })
      expect(result.current.undoLabel).toBe('Discard draft')
      act(() => result.current.undo())
      expect(result.current.design.layout.width).toBe('wide')
    })
  })

  describe('changes the server would refuse', () => {
    it('never commits one: no undo step, no save, and a one-line reason back', async () => {
      vi.useFakeTimers()
      const { result } = setup()
      let outcome: unknown
      act(() => {
        outcome = result.current.update(
          (draft) => void (draft.nav.home.label = 'x'.repeat(41)),
          'Home: label'
        )
      })
      expect(outcome).toEqual({ ok: false, reason: 'Use 40 characters or fewer' })
      expect(result.current.design.nav.home.label).toBeUndefined()
      expect(result.current.undoLabel).toBeNull()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS * 2)
      })
      expect(server.saves).toEqual([])
      // A change that passes still commits after one that did not.
      act(() => {
        outcome = result.current.update((draft) => void (draft.layout.width = 'wide'))
      })
      expect(outcome).toEqual({ ok: true })
      expect(result.current.design.layout.width).toBe('wide')
    })

    it('never resends a document the server refused, and goes back to the last saved one', async () => {
      vi.useFakeTimers()
      server.results = [
        { ok: false, code: 'INVALID_CSS', message: 'Line 1: @import is not allowed' },
      ]
      const { result } = setup()
      act(() => result.current.update((draft) => void (draft.layout.width = 'wide')))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS)
      })
      expect(server.saves).toHaveLength(1)
      expect(result.current.refusal).toBe('Line 1: @import is not allowed')
      // Flushing, as publishing does, sends nothing new.
      await act(async () => {
        await result.current.flush()
      })
      expect(server.saves).toHaveLength(1)
      let published: unknown
      await act(async () => {
        published = await result.current.publish()
      })
      expect(published).toEqual({ ok: false, message: 'Line 1: @import is not allowed' })
      expect(server.published).toEqual([])
      // Going back takes the draft to what the server last saved, as an undo step, and saves it.
      act(() => result.current.recover())
      expect(result.current.design.layout.width).toBe(defaultDesign().layout.width)
      expect(result.current.refusal).toBeNull()
      expect(result.current.undoLabel).toBe('Back to last saved')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS)
      })
      expect(server.saves).toHaveLength(2)
    })
  })

  it('names a change for what it changed, unless given a name', () => {
    const { result } = setup()
    act(() => result.current.update((draft) => void (draft.brand.light.accent = '#0f766e')))
    expect(result.current.undoLabel).toBe('Brand colour')
    act(() => result.current.update((draft) => void (draft.layout.width = 'wide'), 'Add block'))
    expect(result.current.undoLabel).toBe('Add block')
    const before = defaultDesign()
    const after = structuredClone(before)
    after.layout.width = 'wide'
    after.layout.density = 'compact'
    expect(nameOfChange(before, after)).toMatch(/ and 1 more$/)
    expect(nameOfChange(before, before)).toBe('Change')
  })
})
