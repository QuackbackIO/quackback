import { describe, it, expect } from 'vitest'
import { WEBHOOK_EVENT_CONFIG } from '../integrations/webhook/constants'
import { webhookEventTypes } from '../catalogue'

/**
 * WO-9 — the webhook event surface (the admin picker's WEBHOOK_EVENT_CONFIG, and
 * by extension the OpenAPI webhook schemas generated from it) must equal the
 * catalogue's exposure.webhook set. This is the anti-drift gate: it makes the
 * "advertises 4 events, supports 30" divergence impossible — add a webhook event
 * to the catalogue and forget the picker (or vice-versa) and CI turns red.
 */
describe('webhook surface ↔ catalogue (WO-9)', () => {
  it('WEBHOOK_EVENT_CONFIG covers exactly the catalogue webhook-exposed set', () => {
    const picker = new Set<string>(WEBHOOK_EVENT_CONFIG.map((c) => c.id))
    const catalogue = new Set<string>(webhookEventTypes())

    const missingFromPicker = [...catalogue].filter((t) => !picker.has(t))
    const orphanInPicker = [...picker].filter((t) => !catalogue.has(t))

    expect(missingFromPicker).toEqual([])
    expect(orphanInPicker).toEqual([])
  })

  it('every picker entry carries a human label + description', () => {
    for (const c of WEBHOOK_EVENT_CONFIG) {
      expect(c.label, `label for ${c.id}`).toBeTruthy()
      expect(c.description, `description for ${c.id}`).toBeTruthy()
    }
  })
})
