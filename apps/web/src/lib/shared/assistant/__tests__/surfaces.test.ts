import { describe, it, expect } from 'vitest'
import { ASSISTANT_SURFACES, ASSISTANT_SURFACE_LABELS } from '../surfaces'

describe('ASSISTANT_SURFACES', () => {
  it('includes the agent-facing copilot surface', () => {
    expect(ASSISTANT_SURFACES).toContain('copilot')
  })

  it('has no duplicate members', () => {
    expect(new Set(ASSISTANT_SURFACES).size).toBe(ASSISTANT_SURFACES.length)
  })

  it('gives every surface a non-empty label and description', () => {
    for (const surface of ASSISTANT_SURFACES) {
      const copy = ASSISTANT_SURFACE_LABELS[surface]
      expect(copy).toBeDefined()
      expect(copy.label.trim().length).toBeGreaterThan(0)
      expect(copy.description.trim().length).toBeGreaterThan(0)
    }
  })

  it("labels copilot as the inbox's agent-facing assistant", () => {
    expect(ASSISTANT_SURFACE_LABELS.copilot).toEqual({
      label: 'Copilot',
      description: 'The agent-facing assistant in the inbox.',
    })
  })
})
