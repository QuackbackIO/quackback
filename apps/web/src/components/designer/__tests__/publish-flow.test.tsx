// @vitest-environment happy-dom
/**
 * Publish opens a short summary, or the full review when there are more
 * than twelve changes or a check fails; either publishes, and says which.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { DesignCheck } from '@/lib/shared/design/checks'
import { designChanges } from '@/lib/shared/design/diff'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { usePublishFlow, type PublishDraft } from '../publish-flow'

const published = vi.hoisted(() => vi.fn())
vi.mock('@/lib/client/builder-events', async (original) => ({
  ...(await original<typeof import('@/lib/client/builder-events')>()),
  designerPublished: published,
}))
vi.mock('@/lib/server/functions/portal-design', () => ({
  getPortalDesignFn: vi.fn(async () => ({ authors: {} })),
}))
const toast = vi.hoisted(() => ({ success: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

afterEach(() => {
  cleanup()
  published.mockReset()
})

const gates = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: false,
  support: false,
  status: false,
}

const LIVE = { url: 'https://acme.quackback.io', offerDomain: true }

function draftOf(change: (design: PortalDesign) => void, failing = 0) {
  const live = defaultDesign()
  const design = structuredClone(live)
  change(design)
  const publish = vi.fn(async () => ({ ok: true as const, address: LIVE }))
  const draft: PublishDraft = {
    live,
    design,
    changes: designChanges(live, design),
    report: { adjustments: [], errors: [], css: [] },
    canPublish: true,
    published: { revisionId: 'x' as never, number: 1 },
    publish,
    flush: async () => {},
  }
  return { draft, publish, failing }
}

function Harness({
  draft,
  failing,
  checks = [],
  onShowCheck,
}: {
  draft: PublishDraft
  failing: number
  checks?: DesignCheck[]
  onShowCheck?: (part: string) => void
}) {
  const flow = usePublishFlow({
    draft,
    gates,
    failingChecks: failing,
    checks,
    onShowCheck,
    compare: () => null,
  })
  return (
    <>
      <button type="button" onClick={() => void flow.start()}>
        Publish
      </button>
      {flow.published && <output aria-label="Live address">{flow.published.url}</output>}
      {flow.dialogs}
    </>
  )
}

async function clickPublish() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
  })
}

const hideRoadmap = (design: PortalDesign) => {
  const roadmap = design.nav.items.find((item) => item.type === 'roadmap')!
  if (roadmap.type !== 'link') roadmap.shown = false
}

describe('Publish', () => {
  it('lists the things to check in the summary, each with Show me', async () => {
    const { draft, failing } = draftOf(hideRoadmap)
    const onShowCheck = vi.fn()
    const checks = [
      { id: 'band-alt', text: 'The hero image has no description.', part: 'hero' as const },
      { id: 'small', text: 'Some text is under 12px.', part: 'site:styles' as const },
    ]
    render(<Harness draft={draft} failing={failing} checks={checks} onShowCheck={onShowCheck} />)
    await clickPublish()
    const dialog = screen.getByRole('dialog', { name: 'Publish 1 change?' })
    expect(dialog.textContent).toContain('2 things to check')
    expect(dialog.textContent).not.toContain('Every check passes')
    fireEvent.click(screen.getAllByRole('button', { name: 'Show me' })[0]!)
    expect(onShowCheck).toHaveBeenCalledWith('hero')
  })

  it('opens a short summary, menu and landing first', async () => {
    const { draft, failing } = draftOf((design) => {
      design.brand.light.accent = '#225544'
      hideRoadmap(design)
    })
    render(<Harness draft={draft} failing={failing} />)
    await clickPublish()
    const dialog = screen.getByRole('dialog', { name: 'Publish 2 changes?' })
    const text = dialog.textContent!
    expect(text.indexOf('Roadmap out of the menu')).toBeLessThan(text.indexOf('Brand colour'))
    expect(text).toContain('Every check passes')
  })

  it('opens the full review itself for more than twelve changes', async () => {
    const { draft, failing } = draftOf((design) => {
      design.css = 'a {}'
      design.brand.light.accent = '#225544'
      design.brand.light.support = '#225545'
      design.brand.light.background = '#fffffe'
      design.mode = 'dark'
      design.shape.corners = 'sharp'
      design.layout.hero = 'brand'
      design.layout.width = 'narrow'
      design.layout.header = 'centered'
      design.pages.feedback.welcome.show = true
      design.brand.fonts.headingWeight = 700
      design.brand.logo.display = 'name'
      hideRoadmap(design)
    })
    expect(draft.changes.length).toBeGreaterThan(12)
    render(<Harness draft={draft} failing={failing} />)
    await clickPublish()
    // Titled by its count, with no reason to give: a long draft needs none.
    const review = screen.getByRole('dialog', { name: `Review ${draft.changes.length} changes` })
    expect(review.textContent).not.toContain('a lot to sum up')
    expect(
      within(review).getByRole('button', { name: `Publish ${draft.changes.length} changes` })
    ).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: /^Publish/ })).toBeNull()
  })

  it('opens the full review itself when a check fails', async () => {
    const { draft } = draftOf(hideRoadmap)
    render(<Harness draft={draft} failing={1} />)
    await clickPublish()
    const review = screen.getByRole('dialog', { name: 'Review and publish' })
    expect(review.textContent).toContain('A check needs a look before you publish.')
  })

  it('leaves the workspace logo choice unticked, and publishes without it', async () => {
    const { draft, publish, failing } = draftOf((design) => {
      design.brand.logo.mark.light = { key: 'logos/new.png' }
    })
    render(<Harness draft={draft} failing={failing} />)
    await clickPublish()
    const logo = screen.getByRole('checkbox', { name: /Also use the new logo/ })
    expect(logo.getAttribute('aria-checked')).toBe('false')
    await act(async () => {
      fireEvent.click(
        screen
          .getAllByRole('button', { name: 'Publish' })
          .find((each) => each.closest('[role=dialog]'))!
      )
    })
    expect(publish).toHaveBeenCalledWith(undefined, { workspaceLogo: false })
    expect(published).toHaveBeenCalledWith(draft, {
      logoOffered: true,
      workspaceLogo: false,
      fullReview: false,
    })
  })

  it('opens the full review on request, and counts a publish from it as one', async () => {
    const { draft, failing } = draftOf(hideRoadmap)
    render(<Harness draft={draft} failing={failing} />)
    await clickPublish()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'See everything' }))
    })
    const review = screen.getByRole('dialog', { name: 'Review 1 change' })
    await act(async () => {
      fireEvent.click(within(review).getByRole('button', { name: 'Publish 1 change' }))
    })
    expect(published).toHaveBeenCalledWith(draft, expect.objectContaining({ fullReview: true }))
  })

  it('closes the summary on Cancel without publishing', async () => {
    const { draft, publish, failing } = draftOf(hideRoadmap)
    render(<Harness draft={draft} failing={failing} />)
    await clickPublish()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(publish).not.toHaveBeenCalled()
  })
})

describe('After publishing', () => {
  it('hands the live address to Publish rather than a toast', async () => {
    const { draft, failing } = draftOf(hideRoadmap)
    render(<Harness draft={draft} failing={failing} />)
    await clickPublish()
    const dialog = screen.getByRole('dialog', { name: 'Publish 1 change?' })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /^Publish/ }))
    })
    expect(screen.getByLabelText('Live address').textContent).toBe(LIVE.url)
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('opens the full review when a version went live after the draft started, saying so', async () => {
    const { draft, failing } = draftOf(hideRoadmap)
    const message = 'Another version was published after this draft started.'
    draft.publish = vi.fn(async () => ({ ok: false as const, message, changed: true as const }))
    render(<Harness draft={draft} failing={failing} />)
    await clickPublish()
    await act(async () => {
      fireEvent.click(
        screen
          .getAllByRole('button', { name: 'Publish' })
          .find((each) => each.closest('[role=dialog]'))!
      )
    })
    const review = screen.getByRole('dialog', { name: 'Review and publish' })
    expect(review.textContent).toContain(message)
    expect(screen.queryByRole('dialog', { name: /^Publish/ })).toBeNull()
    expect(published).not.toHaveBeenCalled()
  })
})
