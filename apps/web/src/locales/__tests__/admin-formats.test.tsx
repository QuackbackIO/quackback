// @vitest-environment happy-dom
/**
 * Guard: admin dates and numbers follow the page's language. A format pinned
 * to US English ('en-US') or left to the runtime's default (which differs
 * between the server and the browser) reads wrong in every other language;
 * `<LocalDate>`, `useLocalDateFormatter` and `useFormatNumber` format in the
 * page's language and hydrate cleanly.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { describe, expect, it } from 'vitest'
import { formatBucketDay } from '@/components/admin/analytics/analytics-constants'
import { formatMonthlySpend } from '@/components/admin/users/companies-view'
import { DateTimePicker } from '@/components/ui/datetime-picker'
import { formatNumberIn } from '@/components/ui/format-number'
import { adminSourceFiles, SRC_ROOT } from './admin-ratchet'

/** Where a fixed or runtime-default format is the point. */
const EXEMPT = new Set([
  // The first render's own fixed locale, outside any IntlProvider.
  'components/ui/local-date.tsx',
])

const FIXED_FORMATS: { name: string; pattern: RegExp }[] = [
  { name: "a fixed 'en-US'", pattern: /['"`]en-US['"`]/ },
  {
    name: "the runtime's default locale",
    pattern: /\.toLocale(Date|Time)?String\(\s*(undefined|\[\])?\s*[,)]/,
  },
  {
    name: "Intl in the runtime's default or fixed English",
    pattern:
      /new Intl\.(DateTimeFormat|NumberFormat|RelativeTimeFormat)\(\s*(undefined|['"]en['"])/,
  },
]

describe('admin formats', () => {
  it('no admin file pins a date or number to US English or the runtime default', () => {
    const found: string[] = []
    for (const file of adminSourceFiles()) {
      // Server code words text for emails and logs, not for the page.
      if (EXEMPT.has(file) || file.includes('/server/')) continue
      const lines = readFileSync(join(SRC_ROOT, file), 'utf8').split('\n')
      lines.forEach((line, index) => {
        // Comments may name the formats they avoid.
        if (/^\s*(\*|\/\/|\/\*)/.test(line)) return
        for (const { name, pattern } of FIXED_FORMATS) {
          if (pattern.test(line)) found.push(`${file}:${index + 1} ${name}: ${line.trim()}`)
        }
      })
    }
    expect(found).toEqual([])
  })

  it('labels analytics days in the page language', () => {
    expect(formatBucketDay('2026-10-01', 'en')).toBe('Oct 1')
    expect(formatBucketDay('2026-10-01', 'de')).toBe('1. Okt.')
  })

  it('writes money in the page language', () => {
    const de = (value: number, options?: Intl.NumberFormatOptions) =>
      formatNumberIn('de', value, options)
    expect(formatMonthlySpend(123_400, de)).toBe('1.234 $')
    expect(formatMonthlySpend(null, de)).toBe('-')
  })

  it('shows a picked date in the page language', () => {
    render(
      <IntlProvider locale="de" defaultLocale="en">
        <DateTimePicker
          value={new Date('2026-10-01T12:00:00Z')}
          onChange={() => {}}
          dateOnly
          placeholder="Pick"
        />
      </IntlProvider>
    )
    expect(screen.getByText('1. Okt. 2026')).toBeTruthy()
  })
})
