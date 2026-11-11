// @vitest-environment happy-dom
/**
 * A change to one of a picked element's properties draws that property's
 * row again, not every row of the panel: the rows keep their handlers and
 * are drawn again only when what they show changes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('@/components/ui/select', async () => import('@/test/radix-select'))

const drawn = new Map<string, number>()
vi.mock('../properties/scrub-number', () => ({
  ScrubNumber: ({ id, onChange }: { id: string; onChange: (value: number) => void }) => {
    drawn.set(id, (drawn.get(id) ?? 0) + 1)
    return (
      <button type="button" onClick={() => onChange(41)}>
        {`set ${id}`}
      </button>
    )
  },
}))

import { defaultDesign, portalDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { ElementPanel } from '../element-panel'

afterEach(() => {
  cleanup()
  drawn.clear()
  window.sessionStorage.clear()
})

const button = { element: 'button', part: 'hero.home.cta', section: 'hero', index: 0 } as const

function mount() {
  let design: PortalDesign = portalDesign.parse(defaultDesign())
  const update = (change: (draft: PortalDesign) => void) => {
    const draft = structuredClone(design)
    change(draft)
    design = portalDesign.parse(draft)
    view.rerender(panel())
  }
  const panel = () => (
    <ElementPanel
      pick={button}
      page="home"
      blockName="Hero"
      design={design}
      update={update}
      state="base"
      onState={() => {}}
      screen="all"
      onUp={() => {}}
    />
  )
  const view = render(panel())
  return { design: () => design }
}

describe('the element panel’s rows', () => {
  it('draws again only the row whose value changed', () => {
    const { design } = mount()
    const rows = [...drawn.keys()]
    expect(rows.length).toBeGreaterThan(1)
    const [changed, other] = rows as [string, string]
    const before = { changed: drawn.get(changed)!, other: drawn.get(other)! }
    fireEvent.click(screen.getByRole('button', { name: `set ${changed}` }))
    expect(JSON.stringify(design())).toContain('41')
    expect(drawn.get(changed)).toBeGreaterThan(before.changed)
    expect(drawn.get(other)).toBe(before.other)
  })
})
