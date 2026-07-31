import { describe, it, expect } from 'vitest'
import {
  validateTicketIntakeValues,
  TICKET_INTAKE_TEXT_MAX_LENGTH,
  type TicketFormField,
} from '@/lib/shared/tickets'

function field(
  partial: Partial<TicketFormField> & Pick<TicketFormField, 'key' | 'type'>
): TicketFormField {
  return {
    label: partial.label ?? partial.key,
    required: partial.required ?? false,
    visibleToCustomer: partial.visibleToCustomer ?? true,
    order: partial.order ?? 0,
    options: partial.options,
    ...partial,
  }
}

describe('validateTicketIntakeValues', () => {
  it('errors when a required visible field is missing', () => {
    const form = [field({ key: 'severity', type: 'text', required: true })]
    const res = validateTicketIntakeValues(form, {})
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.errors[0].key).toBe('severity')
  })

  it('accepts a present required field', () => {
    const form = [field({ key: 'severity', type: 'text', required: true })]
    const res = validateTicketIntakeValues(form, { severity: 'high' })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.values.severity).toBe('high')
  })

  it('rejects a select value that is not one of the options', () => {
    const form = [field({ key: 'plan', type: 'select', options: ['free', 'pro'] })]
    expect(validateTicketIntakeValues(form, { plan: 'enterprise' }).ok).toBe(false)
    const ok = validateTicketIntakeValues(form, { plan: 'pro' })
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.values.plan).toBe('pro')
  })

  it('coerces number fields and rejects non-numeric', () => {
    const form = [field({ key: 'count', type: 'number' })]
    const ok = validateTicketIntakeValues(form, { count: '42' })
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.values.count).toBe(42)
    expect(validateTicketIntakeValues(form, { count: 'abc' }).ok).toBe(false)
  })

  it('rejects non-string/non-number raws for number fields (no boolean coercion)', () => {
    const form = [field({ key: 'count', type: 'number' })]
    // A boolean raw must not coerce through Number() (true would store as 1).
    expect(validateTicketIntakeValues(form, { count: true }).ok).toBe(false)
    expect(validateTicketIntakeValues(form, { count: false }).ok).toBe(false)
    const ok = validateTicketIntakeValues(form, { count: 3.5 })
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.values.count).toBe(3.5)
  })

  it('validates ISO dates', () => {
    const form = [field({ key: 'when', type: 'date' })]
    expect(validateTicketIntakeValues(form, { when: '2026-07-18' }).ok).toBe(true)
    expect(validateTicketIntakeValues(form, { when: 'yesterday' }).ok).toBe(false)
  })

  it('accepts a full ISO datetime for date fields', () => {
    const form = [field({ key: 'when', type: 'date' })]
    const ok = validateTicketIntakeValues(form, { when: '2026-07-18T10:30:00Z' })
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.values.when).toBe('2026-07-18T10:30:00Z')
  })

  it('rejects impossible calendar dates (Date.parse rolls them over)', () => {
    const form = [field({ key: 'when', type: 'date' })]
    expect(validateTicketIntakeValues(form, { when: '2026-02-31' }).ok).toBe(false)
    expect(validateTicketIntakeValues(form, { when: '2026-04-31' }).ok).toBe(false)
    expect(validateTicketIntakeValues(form, { when: '2026-02-29' }).ok).toBe(false)
    // A leap-year Feb 29 is a real date.
    expect(validateTicketIntakeValues(form, { when: '2028-02-29' }).ok).toBe(true)
  })

  it('rejects trailing junk after an ISO date prefix', () => {
    const form = [field({ key: 'when', type: 'date' })]
    expect(validateTicketIntakeValues(form, { when: '2026-07-18junk' }).ok).toBe(false)
    expect(validateTicketIntakeValues(form, { when: '2026-07-18 10:30' }).ok).toBe(false)
  })

  it('coerces checkbox to boolean and enforces required (must be checked)', () => {
    const optional = [field({ key: 'ok', type: 'checkbox' })]
    const res = validateTicketIntakeValues(optional, { ok: 'true' })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.values.ok).toBe(true)

    const required = [field({ key: 'agree', type: 'checkbox', required: true })]
    expect(validateTicketIntakeValues(required, { agree: false }).ok).toBe(false)
    expect(validateTicketIntakeValues(required, { agree: true }).ok).toBe(true)
  })

  it('rejects a text value over the length cap', () => {
    const form = [field({ key: 'notes', type: 'long_text' })]
    const tooLong = 'x'.repeat(TICKET_INTAKE_TEXT_MAX_LENGTH + 1)
    expect(validateTicketIntakeValues(form, { notes: tooLong }).ok).toBe(false)
    const atLimit = 'y'.repeat(TICKET_INTAKE_TEXT_MAX_LENGTH)
    expect(validateTicketIntakeValues(form, { notes: atLimit }).ok).toBe(true)
  })

  it('drops keys that are not visibleToCustomer', () => {
    const form = [field({ key: 'internal', type: 'text', visibleToCustomer: false })]
    const res = validateTicketIntakeValues(form, { internal: 'secret' })
    expect(res.ok).toBe(true)
    if (res.ok) expect('internal' in res.values).toBe(false)
  })

  it('drops keys not present on the form (never trusted)', () => {
    const form = [field({ key: 'severity', type: 'text' })]
    const res = validateTicketIntakeValues(form, { severity: 'high', rogue: 'x' })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.values.severity).toBe('high')
      expect('rogue' in res.values).toBe(false)
    }
  })

  // Phase 4: the AGENT path (the create dialog fills the type's full field
  // set, customer-hidden fields included) passes includeInternal.
  it('includeInternal accepts + validates customer-hidden fields (the agent path)', () => {
    const form = [
      field({ key: 'severity', type: 'text', required: true }),
      field({
        key: 'internal',
        type: 'select',
        required: true,
        visibleToCustomer: false,
        options: ['a', 'b'],
      }),
    ]
    // Customer-hidden fields are validated like any other on the agent path…
    const res = validateTicketIntakeValues(
      form,
      { severity: 'high', internal: 'b' },
      {
        includeInternal: true,
      }
    )
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.values).toEqual({ severity: 'high', internal: 'b' })

    // …including their required + enum rules.
    expect(
      validateTicketIntakeValues(form, { severity: 'high' }, { includeInternal: true }).ok
    ).toBe(false)
    expect(
      validateTicketIntakeValues(
        form,
        { severity: 'high', internal: 'c' },
        { includeInternal: true }
      ).ok
    ).toBe(false)

    // Without the flag the hidden field stays dropped (customer intake).
    const customer = validateTicketIntakeValues(form, { severity: 'high', internal: 'b' })
    expect(customer.ok).toBe(true)
    if (customer.ok) expect('internal' in customer.values).toBe(false)
  })
})
