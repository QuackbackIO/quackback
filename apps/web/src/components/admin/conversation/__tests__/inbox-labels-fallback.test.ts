/**
 * Values from plain text columns are worded when the client knows them and
 * shown as they are otherwise, so a newer or older value never breaks a row.
 */
import { describe, expect, it } from 'vitest'
import { createIntl } from 'react-intl'
import de from '@/locales/de.json'
import { END_REASON_LABELS, formatLabel, previewText, SPAM_REASON_LABELS } from '../inbox-labels'

const intl = createIntl({ locale: 'de', messages: de })

describe('formatLabel', () => {
  it('words a known value', () => {
    expect(formatLabel(intl, SPAM_REASON_LABELS, 'manual')).toBe(
      de['admin.inbox.labels.spam.manual' as keyof typeof de]
    )
  })

  it('shows an unknown value as it is instead of throwing', () => {
    expect(formatLabel(intl, END_REASON_LABELS, 'archived_by_rule')).toBe('archived_by_rule')
    expect(formatLabel(intl, SPAM_REASON_LABELS, 'toString')).toBe('toString')
  })
})

describe('previewText', () => {
  it("words the server's fixed preview words and leaves other text alone", () => {
    expect(previewText(intl, 'Shared a post')).toBe('Hat einen Beitrag geteilt')
    expect(previewText(intl, 'Image')).toBe(de['admin.inbox.labels.preview.image'])
    expect(previewText(intl, 'Where is my order?')).toBe('Where is my order?')
  })
})
