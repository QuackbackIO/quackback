/**
 * A date intake answer is a calendar date ("2026-10-01"). Read as a moment it
 * is UTC midnight, still Sep 30 in Los Angeles, so the answer must show the
 * day as written, in the visitor's language, for every visitor.
 */
import { createIntl } from 'react-intl'
import { afterEach, describe, expect, it } from 'vitest'
import type { TicketFormField } from '@/lib/shared/tickets'
import { restoreRuntimeLocale, setRuntimeLocale } from '@/test/runtime-locale'
import { formatIntakeValue } from '../ticket-header-card'

afterEach(restoreRuntimeLocale)

const field: TicketFormField = {
  key: 'incident_day',
  label: 'Day it happened',
  type: 'date',
  required: false,
  visibleToCustomer: true,
  order: 0,
}

describe('formatIntakeValue', () => {
  it('shows a date answer as the day it names, west of UTC', () => {
    setRuntimeLocale('en-US', 'America/Los_Angeles')
    expect(formatIntakeValue(field, '2026-10-01', createIntl({ locale: 'en' }))).toBe('Oct 1, 2026')
  })

  it("formats the day in the visitor's language", () => {
    expect(formatIntakeValue(field, '2026-10-01', createIntl({ locale: 'de' }))).toBe(
      '1. Okt. 2026'
    )
  })

  it('shows a value that is not a calendar date as given', () => {
    expect(formatIntakeValue(field, 'next week', createIntl({ locale: 'en' }))).toBe('next week')
  })
})
