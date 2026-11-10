// @vitest-environment happy-dom
/**
 * The canvas takes the welcome message with the rest of the design, never on
 * the old structural channel, so a welcome edit reaches it as any change does.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { designView } from '@/lib/shared/design/design-view'
import { savedWelcomeCard } from '@/lib/shared/design/view'
import { NO_STRUCTURE } from '../designer-canvas'
import { useCanvasInput } from '../use-canvas-input'

const welcomed = (text: string) => {
  const design = defaultDesign()
  design.pages.feedback.welcome = {
    show: true,
    body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
  } as PortalDesign['pages']['feedback']['welcome']
  return design
}

describe('useCanvasInput', () => {
  it('sends no structural draft, whatever the welcome message says', () => {
    const { result, rerender } = renderHook(({ design }) => useCanvasInput(design, vi.fn(), 'en'), {
      initialProps: { design: welcomed('Hello') },
    })
    expect(result.current.structural).toBe(NO_STRUCTURE)
    expect(result.current.structural).not.toHaveProperty('welcomeCard')
    rerender({ design: welcomed('Hi there') })
    expect(result.current.structural).toBe(NO_STRUCTURE)
  })

  it('draws the welcome message from the design, the draft’s in the builder', () => {
    const card = savedWelcomeCard(designView(welcomed('Hi there'), null), {
      body: 'a settings draft',
    })
    expect(JSON.stringify(card)).toContain('Hi there')
  })
})
