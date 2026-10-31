// @vitest-environment happy-dom
/**
 * Home in Sections: turning it on starts it with a layout built from the
 * workspace's pages, its blocks reorder and go, a block whose page is off says
 * so, and a link reaches the draft only once it is a whole link.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { defaultDesign, portalDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { newBlock } from '@/lib/shared/design/home'

vi.mock('@/components/admin/settings/branding/welcome-body-editor', () => ({
  WelcomeBodyEditor: () => <div data-testid="welcome-editor" />,
}))
vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: { roadmaps: () => ({ queryKey: ['roadmaps'], queryFn: async () => [] }) },
}))

const { HomeSection } = await import('../home-section')

const ALL_ON = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}

function renderSection(start: PortalDesign = defaultDesign(), gates = ALL_ON) {
  const seen = { design: start, edits: 0 }
  function Harness() {
    const [design, setDesign] = useState(start)
    return (
      <HomeSection
        design={design}
        gates={gates}
        onEdit={() => seen.edits++}
        update={(change) => {
          const next = structuredClone(design)
          change(next)
          seen.design = next
          setDesign(next)
        }}
      />
    )
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Harness />
    </QueryClientProvider>
  )
  return seen
}

const types = (design: PortalDesign) => design.pages.home.blocks.map((block) => block.type)

const withHome = (...blocks: PortalDesign['pages']['home']['blocks']) => {
  const doc = defaultDesign()
  doc.nav.home.on = true
  doc.pages.home.blocks = blocks
  return doc
}

afterEach(cleanup)

describe('Home in Sections', () => {
  it('starts Home with the pages the workspace has, and shows it in the preview', () => {
    const seen = renderSection(defaultDesign(), { ...ALL_ON, roadmap: false, status: false })
    fireEvent.click(screen.getByRole('switch', { name: 'Home page' }))
    expect(seen.design.nav.home.on).toBe(true)
    expect(types(seen.design)).toEqual(['welcome', 'composer', 'ideas', 'updates', 'help_topics'])
    expect(portalDesign.safeParse(seen.design).success).toBe(true)
    expect(seen.edits).toBe(1)
  })

  it('keeps the blocks a workspace already has when Home goes back on', () => {
    const doc = withHome(newBlock('status'))
    doc.nav.home.on = false
    const seen = renderSection(doc)
    fireEvent.click(screen.getByRole('switch', { name: 'Home page' }))
    expect(types(seen.design)).toEqual(['status'])
  })

  it('reorders and removes blocks', () => {
    const seen = renderSection(
      withHome(newBlock('composer'), newBlock('status'), newBlock('links'))
    )
    expect(screen.getByRole('button', { name: 'Move Share an idea up' })).toHaveProperty(
      'disabled',
      true
    )
    fireEvent.click(screen.getByRole('button', { name: 'Move Share an idea down' }))
    expect(types(seen.design)).toEqual(['status', 'composer', 'links'])
    fireEvent.click(screen.getByRole('button', { name: 'Move Links up' }))
    expect(types(seen.design)).toEqual(['status', 'links', 'composer'])
    fireEvent.click(screen.getByRole('button', { name: 'Remove Status' }))
    expect(types(seen.design)).toEqual(['links', 'composer'])
  })

  it('says when a block’s page is off', () => {
    renderSection(withHome(newBlock('status'), newBlock('ideas')), { ...ALL_ON, status: false })
    const blocks = screen.getAllByRole('listitem')
    expect(within(blocks[0]!).getByText('Hidden while Status is off')).toBeTruthy()
    expect(within(blocks[1]!).queryByText(/Hidden while/)).toBeNull()
  })

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
