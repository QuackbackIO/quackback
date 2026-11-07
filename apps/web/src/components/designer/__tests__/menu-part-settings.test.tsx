// @vitest-environment happy-dom
/**
 * A menu link's settings, as Edit link leads to them: its address and new
 * tab, under the header in the breadcrumb; and "+" at the end of the menu,
 * which adds a link or leads to turning a part on.
 */
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { newBlock } from '@/lib/shared/design/home'
import { addMenuLink } from '@/lib/shared/design/menu'
import type { Selection } from '@/lib/shared/design/outline'
import { MenuAdd } from '../menu-add'
import { MenuPartSettings } from '../menu-part-settings'
import { resetNewParts } from '../use-new-parts'

afterEach(() => {
  cleanup()
  resetNewParts()
  localStorage.clear()
  vi.restoreAllMocks()
})

const gates = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: false,
  status: false,
}

function withHome() {
  const design = defaultDesign()
  design.nav.home = { on: true, tab: true }
  design.pages.home.blocks = [
    { ...newBlock('welcome'), id: 'welcome1' },
    { ...newBlock('roadmap'), id: 'roadmap1' },
  ]
  return design
}

/** One draft with its updates and their names, as the builder holds it. */
function useDraft(start: PortalDesign, drafts: PortalDesign[], labels: Array<string | undefined>) {
  const [design, setDesign] = useState(start)
  const update = (change: (draft: PortalDesign) => void, label?: string) =>
    setDesign((before) => {
      const next = structuredClone(before)
      change(next)
      drafts.push(next)
      labels.push(label)
      return next
    })
  return [design, update] as const
}

function show(selection: Selection, start: PortalDesign) {
  const drafts: PortalDesign[] = []
  const labels: Array<string | undefined> = []
  const onRename = vi.fn()
  const onRemoved = vi.fn()
  const onHeader = vi.fn()
  function Builder() {
    const [design, update] = useDraft(start, drafts, labels)
    return (
      <MenuPartSettings
        selection={selection}
        crumbs={[
          { label: 'Home' },
          { label: 'Header and menu', onSelect: onHeader },
          { label: 'Docs' },
        ]}
        design={design}
        update={update}
        onRename={onRename}
        onRemoved={onRemoved}
      />
    )
  }
  render(<Builder />)
  return { latest: () => drafts.at(-1)!, drafts, labels, onRename, onRemoved, onHeader }
}

function withLink() {
  const design = withHome()
  const id = addMenuLink(design, { label: 'Docs', url: 'https://example.com/docs' })
  return { design, selection: `link:${id}` as Selection }
}

describe('MenuPartSettings', () => {
  it('names the link under the header, which the breadcrumb goes back to', () => {
    const { design, selection } = withLink()
    const { onHeader } = show(selection, design)
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Docs')
    fireEvent.click(screen.getByRole('button', { name: 'Header and menu' }))
    expect(onHeader).toHaveBeenCalled()
  })

  it('changes the address once it is a whole one, and the new tab', () => {
    const { design, selection } = withLink()
    const { latest, drafts, labels } = show(selection, design)
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'docs' } })
    expect(drafts).toHaveLength(0)
    expect(screen.getByText('Use a full address starting with https://')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Address'), {
      target: { value: 'https://example.com/help' },
    })
    expect(latest().nav.items.at(-1)).toMatchObject({ url: 'https://example.com/help' })
    // A link opens a new tab until told otherwise.
    fireEvent.click(screen.getByRole('switch', { name: 'New tab' }))
    expect(latest().nav.items.at(-1)).toMatchObject({ newTab: false })
    expect(labels).toEqual(['Menu link', 'Menu link'])
  })

  it('has no name field: a link is renamed where the menu draws it', () => {
    const { design, selection } = withLink()
    show(selection, design)
    expect(screen.queryByLabelText('Name')).toBeNull()
    expect(screen.queryByLabelText('Name in the menu')).toBeNull()
  })

  it('removes the link, named for undo, and goes up', () => {
    const { design, selection } = withLink()
    const { latest, labels, onRemoved } = show(selection, design)
    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }))
    expect(latest().nav.items.some((item) => item.type === 'link')).toBe(false)
    expect(labels).toEqual(['Remove the Docs link'])
    expect(onRemoved).toHaveBeenCalled()
  })

  it('shows nothing for a pick that is not a link', () => {
    const { container } = render(
      <MenuPartSettings
        selection="page:roadmap"
        crumbs={[]}
        design={withHome()}
        update={vi.fn()}
        onRename={vi.fn()}
        onRemoved={vi.fn()}
      />
    )
    expect(container.textContent).toBe('')
  })
})

function showAdd(start: PortalDesign = withHome()) {
  const drafts: PortalDesign[] = []
  const labels: Array<string | undefined> = []
  const onSample = vi.fn()
  const onDone = vi.fn()
  function Builder() {
    const [design, update] = useDraft(start, drafts, labels)
    return (
      <MenuAdd
        design={design}
        gates={gates}
        settings={{ featureFlags: {} }}
        update={update}
        onSample={onSample}
        onDone={onDone}
      />
    )
  }
  render(<Builder />)
  return { latest: () => drafts.at(-1)!, drafts, labels, onSample, onDone }
}

describe('MenuAdd', () => {
  it('adds a link to the end of the menu, named for undo', () => {
    const { latest, labels, onDone } = showAdd()
    fireEvent.click(screen.getByRole('button', { name: 'Link' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Docs' } })
    fireEvent.change(screen.getByLabelText('Address'), {
      target: { value: 'https://example.com/docs' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(latest().nav.items.at(-1)).toMatchObject({
      type: 'link',
      label: 'Docs',
      url: 'https://example.com/docs',
    })
    expect(labels).toEqual(['Add the Docs link'])
    expect(onDone).toHaveBeenCalled()
  })

  it('refuses a link without a whole address', () => {
    const { drafts } = showAdd()
    fireEvent.click(screen.getByRole('button', { name: 'Link' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Docs' } })
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'docs' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(drafts).toHaveLength(0)
    expect(screen.getByText('Use a full address starting with https://')).toBeTruthy()
  })

  it('offers Support and Status, turned on live in Settings or previewed with samples', () => {
    const { onSample } = showAdd()
    const links = screen.getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual([
      'Turn on (goes live, opens in a new tab)',
      'Turn on (goes live, opens in a new tab)',
    ])
    expect(links.every((link) => link.getAttribute('href')?.startsWith('/admin/settings/'))).toBe(
      true
    )
    fireEvent.click(screen.getByRole('button', { name: 'Preview Status with sample content' }))
    expect(onSample).toHaveBeenCalledWith('status')
  })
})

describe('MenuAdd, heading and limits', () => {
  it('is headed as its trigger is', () => {
    showAdd()
    expect(screen.getByRole('heading', { name: 'Add to the menu' })).toBeTruthy()
  })

  it('says why a full menu takes no more links', () => {
    const design = withHome()
    for (let i = 0; design.nav.items.length < 16; i++)
      addMenuLink(design, { label: `L${i}`, url: 'https://example.com' })
    showAdd(design)
    const add = screen.getByRole('button', { name: 'Link' })
    expect(add.hasAttribute('disabled')).toBe(true)
    expect(add.getAttribute('title')).toBe('The menu holds 16')
  })
})
