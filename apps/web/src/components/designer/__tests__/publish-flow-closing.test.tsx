// @vitest-environment happy-dom
/**
 * A publish dialog closes as it was when Publish was pressed. Publishing
 * empties the draft's changes, and a dialog fading out with its content gone
 * collapsed into a stub, with its Publish button usable again.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { designChanges } from '@/lib/shared/design/diff'
import { defaultDesign } from '@/lib/shared/design/schema'
import type { PublishDraft } from '../publish-flow'

// The dialog as it is while it fades out: still drawn, whatever `open` says.
vi.mock('../publish-summary-dialog', () => ({
  fullReviewReason: () => '',
  PublishSummaryDialog: (props: {
    open: boolean
    count: number
    summary: { look: { title: string }[] }
    onPublish: (options: { workspaceLogo: boolean }) => Promise<unknown>
    onOpenChange: (open: boolean) => void
  }) => (
    <section aria-label="Summary" data-open={props.open || undefined}>
      <p>{`${props.count} changes`}</p>
      <p>{props.summary.look.map((row) => row.title).join(', ')}</p>
      <button
        type="button"
        onClick={async () => {
          await props.onPublish({ workspaceLogo: false })
          props.onOpenChange(false)
        }}
      >
        Publish now
      </button>
    </section>
  ),
}))
vi.mock('@/lib/client/builder-events', async (original) => ({
  ...(await original<typeof import('@/lib/client/builder-events')>()),
  designerPublished: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))

const { usePublishFlow } = await import('../publish-flow')

afterEach(cleanup)

const gates = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: false,
  support: false,
  status: false,
}

function drafts() {
  const live = defaultDesign()
  const design = structuredClone(live)
  design.brand.light.accent = '#225544'
  const base = {
    report: { adjustments: [], errors: [], css: [] },
    canPublish: true,
    published: { revisionId: 'x' as never, number: 1 },
    flush: async () => {},
  }
  const before: PublishDraft = {
    ...base,
    live,
    design,
    changes: designChanges(live, design),
    publish: vi.fn(async () => ({ ok: true as const })),
  }
  // What the draft reads once published: nothing left to publish.
  const after: PublishDraft = { ...before, live: design, changes: [] }
  return { before, after }
}

function Harness({ draft }: { draft: PublishDraft }) {
  const flow = usePublishFlow({ draft, gates, failingChecks: 0, compare: () => null })
  return (
    <>
      <button type="button" onClick={() => void flow.start()}>
        Start
      </button>
      {flow.dialogs}
    </>
  )
}

describe('a publish dialog closing', () => {
  it('keeps what it showed while it fades out after publishing', async () => {
    const { before, after } = drafts()
    const view = render(<Harness draft={before} />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start' })))
    const summary = screen.getByRole('region', { name: 'Summary' })
    expect(summary.hasAttribute('data-open')).toBe(true)
    const shown = summary.textContent
    expect(shown).toContain('1 changes')
    expect(shown).toContain('Brand colour')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Publish now' })))
    view.rerender(<Harness draft={after} />)
    const closing = screen.getByRole('region', { name: 'Summary' })
    expect(closing.hasAttribute('data-open')).toBe(false)
    expect(closing.textContent).toBe(shown)
  })
})
