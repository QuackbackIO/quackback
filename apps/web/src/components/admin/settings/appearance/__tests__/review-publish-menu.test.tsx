// @vitest-environment happy-dom
/** The full review leads with where visitors land and the menu, as the short summary does. */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { designChanges } from '@/lib/shared/design/diff'
import { defaultDesign } from '@/lib/shared/design/schema'
import { ReviewPublishDialog } from '../review-publish-dialog'

afterEach(cleanup)

describe('the full review', () => {
  it('lists menu and landing changes first, and not again with the rest', () => {
    const live = defaultDesign()
    const draft = structuredClone(live)
    draft.nav.items[1] = { type: 'roadmap', shown: false }
    draft.brand.light.accent = '#225544'
    render(
      <ReviewPublishDialog
        open
        onOpenChange={() => {}}
        changes={designChanges(live, draft)}
        menu={[
          { kind: 'Menu', title: 'Roadmap out of the menu', detail: 'Still open at /roadmap' },
        ]}
        report={{ adjustments: [], errors: [] }}
        onPublish={async () => ({ ok: true })}
        canPublish
      />
    )
    const headings = screen.getAllByRole('heading', { level: 3 }).map((each) => each.textContent)
    expect(headings[0]).toBe('Menu and landing')
    expect(headings).not.toContain('Header and menu')
    expect(document.body.textContent).toContain('Roadmap out of the menu')
    expect(document.body.textContent).toContain('Still open at /roadmap')
  })
})
