// @vitest-environment happy-dom
/**
 * Ask AI shows changes already in the draft, each row undoable on its own,
 * and says what the solver adjusted to keep text readable. With no model set
 * up it says so in one line.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { AskAiPanel } from '../ask-ai-panel'
import type { DesignAiTurn, DesignLook } from '../use-design-ai'

let draft: PortalDesign
const update = (change: (d: PortalDesign) => void) => {
  const next = structuredClone(draft)
  change(next)
  draft = next
}

function mount(props: Partial<Parameters<typeof AskAiPanel>[0]> = {}) {
  return render(
    <AskAiPanel
      available
      turns={[]}
      busy={false}
      update={update}
      onStart={() => {}}
      onLook={() => {}}
      onPresets={() => {}}
      onWiden={() => {}}
      {...props}
    />
  )
}

beforeEach(() => {
  draft = defaultDesign()
})
afterEach(cleanup)

describe('AskAiPanel', () => {
  it('says why in one line when no model is set up', () => {
    mount({ available: false })
    expect(screen.getByText(/not set up for this workspace/)).toBeTruthy()
    expect(screen.queryByLabelText('Match my website')).toBeNull()
  })

  it('starts from a website or a few words', () => {
    const starts: string[][] = []
    mount({ onStart: (kind, value) => starts.push([kind, value]) })
    fireEvent.change(screen.getByLabelText('Match my website'), {
      target: { value: ' example.com ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    fireEvent.change(screen.getByLabelText('Describe your brand'), { target: { value: 'calm' } })
    fireEvent.click(screen.getByRole('button', { name: 'Suggest three looks' }))
    expect(starts).toEqual([
      ['website', 'example.com'],
      ['words', 'calm'],
    ])
  })

  it('undoes one row of a change card and leaves the others', () => {
    draft.layout.density = 'compact'
    draft.brand.light.accent = '#0f766e'
    const turns: DesignAiTurn[] = [
      { role: 'user', text: 'Tighter, green' },
      {
        role: 'assistant',
        text: 'Tighter and greener.',
        changes: [
          { path: 'layout.density', before: 'comfortable', after: 'compact' },
          { path: 'brand.light.accent', before: 'oklch(0.886 0.176 86)', after: '#0f766e' },
        ],
        readability: ['button text on the accent'],
      },
    ]
    mount({ turns })
    expect(screen.getByText('Changes applied to your draft')).toBeTruthy()
    expect(screen.getByText(/also adjusted button text on the accent/)).toBeTruthy()
    expect(screen.getByText('Comfortable')).toBeTruthy()
    expect(screen.queryByText('comfortable')).toBeNull()

    fireEvent.click(screen.getAllByRole('button', { name: 'Undo' })[0])
    expect(draft.layout.density).toBe('comfortable')
    expect(draft.brand.light.accent).toBe('#0f766e')
    expect(screen.getByText('Undone')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(draft.brand.light.accent).toBe('oklch(0.886 0.176 86)')
    expect(screen.getByText('Changes undone')).toBeTruthy()
  })

  it('puts a picked look into the draft', () => {
    const design = defaultDesign()
    design.layout.band = 'brand'
    design.brand.fonts.heading = { kind: 'bundled', id: 'fraunces' }
    const look: DesignLook = { name: 'Bold', description: 'Loud.', preset: 'bold', design }
    const picked: string[] = []
    mount({
      turns: [{ role: 'assistant', text: 'Here are three looks.', looks: [look] }],
      onLook: (chosen) => picked.push(chosen.name),
    })
    expect(screen.getByText('Fraunces and Inter')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Bold/ }))
    expect(draft.layout.band).toBe('brand')
    expect(picked).toEqual(['Bold'])
  })

  it('offers to ask about the whole site when a request reached outside the section', () => {
    const widened: string[] = []
    mount({
      turns: [
        { role: 'user', text: 'A green band' },
        {
          role: 'assistant',
          text: 'That is outside the header, so nothing changed.',
          widen: 'A green band',
        },
      ],
      onWiden: (text) => widened.push(text),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ask about the whole site' }))
    expect(widened).toEqual(['A green band'])
  })
})
