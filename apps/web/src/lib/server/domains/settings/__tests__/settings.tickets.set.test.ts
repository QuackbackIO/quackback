/**
 * setStageLabels writes one label at a time (the settings card saves per field),
 * so it must keep the labels already saved rather than resetting them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({ metadata: null as string | null, written: null as unknown }))

vi.mock('../settings.helpers', () => ({
  requireSettingsCached: async () => ({ metadata: state.metadata }),
  writeMetadataKey: async (_key: string, value: unknown) => {
    state.written = value
  },
  wrapDbError: (_msg: string, error: unknown) => error,
}))

import { setStageLabels, DEFAULT_TICKET_STAGE_LABELS } from '../settings.tickets'

describe('setStageLabels', () => {
  beforeEach(() => {
    state.metadata = null
    state.written = null
  })

  it('keeps the other saved labels when one label is saved', async () => {
    state.metadata = JSON.stringify({
      ticketStageLabels: { received: 'Eingegangen', resolved: 'Erledigt' },
    })
    const result = await setStageLabels({ in_progress: 'In Arbeit' })
    expect(result.received).toBe('Eingegangen')
    expect(result.resolved).toBe('Erledigt')
    expect(result.in_progress).toBe('In Arbeit')
    expect(state.written).toEqual(result)
  })

  it('fills unsaved labels from the defaults', async () => {
    const result = await setStageLabels({ resolved: 'Done' })
    expect(result).toEqual({ ...DEFAULT_TICKET_STAGE_LABELS, resolved: 'Done' })
  })
})
