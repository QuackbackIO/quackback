// @vitest-environment happy-dom
/**
 * Home's links: a link reaches the draft only once it is a whole link. (The
 * composer's place is the hero's setting.)
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { defaultDesign, portalDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { newBlock } from '@/lib/shared/design/home'

const { LinksOptions } = await import('../home-section')

function renderSection(start: PortalDesign = defaultDesign()) {
  const seen = { design: start, edits: 0 }
  function Harness() {
    const [design, setDesign] = useState(start)
    const edit = (change: (draft: PortalDesign) => void) => {
      const next = structuredClone(design)
      change(next)
      seen.design = next
      seen.edits++
      setDesign(next)
    }
    const blocks = design.pages.home.blocks
    return (
      <>
        {blocks.map((block, index) =>
          block.type === 'links' ? (
            <LinksOptions
              key={block.id ?? index}
              block={block}
              withHeading={false}
              change={(apply) => edit((draft) => apply(draft.pages.home.blocks[index]!))}
            />
          ) : null
        )}
      </>
    )
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Harness />
    </QueryClientProvider>
  )
  return seen
}

const withHome = (...blocks: PortalDesign['pages']['home']['blocks']) => {
  const doc = defaultDesign()
  doc.nav.home.on = true
  doc.pages.home.blocks = blocks
  return doc
}

afterEach(cleanup)

describe('Home’s blocks', () => {
  it('saves a link only once it has a name and a whole address', async () => {
    const seen = renderSection(withHome(newBlock('links')))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add a link' })))
    const before = structuredClone(seen.design.pages.home.blocks[0])
    fireEvent.change(screen.getByRole('textbox', { name: 'Link 2 name' }), {
      target: { value: 'Docs' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Link 2 address' }), {
      target: { value: 'https://' },
    })
    expect(seen.design.pages.home.blocks[0]).toEqual(before)
    fireEvent.change(screen.getByRole('textbox', { name: 'Link 2 address' }), {
      target: { value: 'docs.example.com' },
    })
    expect(seen.design.pages.home.blocks[0]).toEqual(before)
    // It says why, and the field points to it.
    const address = screen.getByRole('textbox', { name: 'Link 2 address' })
    expect(screen.getByRole('alert').textContent).toContain('starting with https://')
    expect(address.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id)
    fireEvent.change(screen.getByRole('textbox', { name: 'Link 2 address' }), {
      target: { value: 'https://docs.example.com' },
    })
    const block = seen.design.pages.home.blocks[0] as Extract<
      PortalDesign['pages']['home']['blocks'][number],
      { type: 'links' }
    >
    expect(block.links.at(-1)).toEqual({ label: 'Docs', url: 'https://docs.example.com' })
    expect(portalDesign.safeParse(seen.design).success).toBe(true)
  })
})
