/**
 * Read-time resolution for the ticket settings families (support platform §4.2):
 * stage labels merge over defaults, and per-type intake forms default to empty
 * and silently drop stored fields that fail validation. Pure (no db) — mirrors
 * the office-hours resolver tests.
 */
import { describe, it, expect } from 'vitest'
import {
  resolveStageLabels,
  resolveTicketForms,
  DEFAULT_TICKET_STAGE_LABELS,
} from '../settings.tickets'

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

describe('resolveTicketForms', () => {
  const field = {
    key: 'company_size',
    label: 'Company size',
    type: 'text',
    required: false,
    visibleToCustomer: true,
    order: 0,
  }

  it('defaults every ticket type to an empty form', () => {
    const forms = resolveTicketForms(null)
    expect(forms.customer).toEqual([])
    expect(forms.back_office).toEqual([])
    expect(forms.tracker).toEqual([])
  })

  it('returns a stored, valid form for its type only', () => {
    const forms = resolveTicketForms(meta({ ticketForms: { customer: [field] } }))
    expect(forms.customer).toHaveLength(1)
    expect(forms.customer[0].key).toBe('company_size')
    expect(forms.back_office).toEqual([])
  })

  it('drops a stored form that fails validation (select without options)', () => {
    const bad = { ...field, key: 'plan', type: 'select' } // select requires options
    const forms = resolveTicketForms(meta({ ticketForms: { customer: [bad] } }))
    expect(forms.customer).toEqual([])
  })
})
