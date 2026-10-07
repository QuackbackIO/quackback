// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { createIntl, FormattedMessage } from 'react-intl'
import { PortalIntlProvider } from '@/components/portal-intl-provider'
import { loadMessages, loadWidgetMessages } from '@/lib/shared/i18n'
import { htmlLangDir } from '@/lib/shared/document-locale'

describe('Thai locale runtime wiring', () => {
  it('loads the Thai catalog and widget slice without falling back to English', async () => {
    const [en, th, widget] = await Promise.all([
      loadMessages('en'),
      loadMessages('th'),
      loadWidgetMessages('th'),
    ])
    expect(th['portal.header.nav.roadmap']).toBe('แผนพัฒนา')
    expect(th['portal.header.nav.roadmap']).not.toBe(en['portal.header.nav.roadmap'])
    expect(widget['widget.home.form.submit']).toBe('ส่ง')
    expect(widget['helpAskAi.sources']).toBe('แหล่งข้อมูล')
    expect(htmlLangDir('th')).toEqual({ lang: 'th', dir: 'ltr' })
  })

  it('renders Thai on the first render when the server supplies messages', async () => {
    const messages = await loadMessages('th')
    render(
      <PortalIntlProvider locale="th" messages={messages}>
        <span data-testid="thai-ssr">
          <FormattedMessage id="portal.header.nav.roadmap" defaultMessage="Roadmap" />
        </span>
      </PortalIntlProvider>
    )
    expect(screen.getByTestId('thai-ssr').textContent).toBe('แผนพัฒนา')
  })

  it('loads Thai asynchronously through the portal provider', async () => {
    render(
      <PortalIntlProvider locale="th">
        <span data-testid="thai-async">
          <FormattedMessage id="widget.postDetail.comments" values={{ count: 3 }} />
        </span>
      </PortalIntlProvider>
    )
    await waitFor(() => expect(screen.getByTestId('thai-async').textContent).toBe('3 ความคิดเห็น'))
  })

  it('formats Thai plurals, rich text, dates, and numbers with the real Intl runtime', async () => {
    const messages = await loadMessages('th')
    const errors: unknown[] = []
    const intl = createIntl({ locale: 'th', messages, onError: (error) => errors.push(error) })
    for (const count of [0, 1, 2, 21]) {
      expect(intl.formatMessage({ id: 'widget.postDetail.comments' }, { count })).toBe(
        `${count} ความคิดเห็น`
      )
    }
    expect(
      intl.formatMessage({ id: 'automation.whoRepliesFirst.step1' }, { b: (chunks) => chunks })
    ).toBe('Quinn ตอบทันทีตลอดเวลาที่เปิดใช้ ทั้งวันทั้งคืน')
    expect(intl.formatNumber(1234.5)).toBe(new Intl.NumberFormat('th').format(1234.5))
    const date = new Date('2026-10-08T00:00:00Z')
    const dateOptions = { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' } as const
    expect(intl.formatDate(date, dateOptions)).toBe(
      new Intl.DateTimeFormat('th', dateOptions).format(date)
    )
    expect(errors).toEqual([])
  })
})
