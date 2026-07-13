// @vitest-environment happy-dom
/**
 * Phase 6 housekeeping: lock in that no webhook event category — including
 * `configuration` — is auto-selected. The create-webhook dialog initializes
 * `selectedEvents` to `[]`; verify the picker honours that and renders every
 * category with a `(0/N)` counter and no checkboxes pre-checked.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/lib/server/functions/webhooks', () => ({
  fetchSamplePayloadsFn: vi.fn(async () => ({})),
}))

import { WebhookEventPicker } from '../webhook-event-picker'
import { WEBHOOK_EVENT_CATEGORIES, WEBHOOK_EVENT_CONFIG } from '@/lib/shared/webhook-events'

function renderPicker(value: string[] = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <WebhookEventPicker value={value} onChange={vi.fn()} />
    </QueryClientProvider>
  )
}

describe('WebhookEventPicker defaults (Phase 6 housekeeping)', () => {
  it('renders every category with 0/N selected when value is empty', () => {
    renderPicker([])

    for (const cat of WEBHOOK_EVENT_CATEGORIES) {
      const total = WEBHOOK_EVENT_CONFIG.filter((e) => e.category === cat.id).length
      if (total === 0) continue
      const counter = `(0/${total})`
      const matches = screen.getAllByText((_, node) => {
        if (!node) return false
        const txt = node.textContent ?? ''
        return txt.includes(cat.label) && txt.includes(counter)
      })
      expect(matches.length).toBeGreaterThan(0)
    }
  })

  it('does NOT pre-check the configuration category (or any other)', () => {
    renderPicker([])

    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(checkboxes.length).toBe(WEBHOOK_EVENT_CONFIG.length)
    for (const cb of checkboxes) {
      // Radix renders checked state via aria-checked + data-state, not the
      // native `checked` prop.
      expect(cb.getAttribute('aria-checked')).not.toBe('true')
      expect(cb.getAttribute('data-state')).not.toBe('checked')
    }
  })

  it('configuration category is opt-in (no events from it included by default)', () => {
    renderPicker([])
    const configurationEventIds = WEBHOOK_EVENT_CONFIG.filter(
      (e) => e.category === 'configuration'
    ).map((e) => e.id)
    expect(configurationEventIds.length).toBeGreaterThan(0)
    // Sanity: the picker exposes per-event aria-labels of the form
    // "Subscribe to <Label> events". Every configuration checkbox must be
    // unchecked.
    for (const id of configurationEventIds) {
      const cfg = WEBHOOK_EVENT_CONFIG.find((e) => e.id === id)!
      const cb = screen.getByLabelText(`Subscribe to ${cfg.label} events`) as HTMLInputElement
      expect(cb.getAttribute('aria-checked')).not.toBe('true')
    }
  })
})
