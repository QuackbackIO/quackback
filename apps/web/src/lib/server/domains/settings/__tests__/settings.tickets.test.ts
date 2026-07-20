/**
 * Read-time resolution for the ticket settings family (support platform §4.2):
 * stage labels merge over defaults. Pure (no db) — mirrors the office-hours
 * resolver tests.
 */
import { describe, it, expect } from 'vitest'
import { resolveStageLabels, DEFAULT_TICKET_STAGE_LABELS } from '../settings.tickets'

const meta = (bag: Record<string, unknown>): string => JSON.stringify(bag)

describe('resolveStageLabels', () => {
  it('defaults every slot when the bag is empty or absent', () => {
    expect(resolveStageLabels(null)).toEqual(DEFAULT_TICKET_STAGE_LABELS)
    expect(resolveStageLabels('{}')).toEqual(DEFAULT_TICKET_STAGE_LABELS)
  })

  it('merges a partial saved map over the defaults', () => {
    const labels = resolveStageLabels(meta({ ticketStageLabels: { resolved: 'Done' } }))
    expect(labels.resolved).toBe('Done')
    expect(labels.received).toBe('Received')
    expect(labels.awaiting_requester).toBe('Awaiting your reply')
  })

  it('falls back to defaults when a stored label is invalid', () => {
    // An empty label fails the min(1) rule, so the whole map resolves to defaults.
    expect(resolveStageLabels(meta({ ticketStageLabels: { received: '' } }))).toEqual(
      DEFAULT_TICKET_STAGE_LABELS
    )
  })
})
