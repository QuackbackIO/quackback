import { describe, expect, it } from 'vitest'
import { CANVAS_PICKED } from '../canvas-colours'
import { DESIGNER_CSS } from '@/components/public/portal-preview-designer'

describe('canvas colours', () => {
  it('outlines words being edited in the frame with the same blue as the picked block', () => {
    // The frame's script repeats the blue as a literal so it imports nothing from the builder.
    expect(DESIGNER_CSS).toContain(`outline:2px solid ${CANVAS_PICKED}`)
  })
})
