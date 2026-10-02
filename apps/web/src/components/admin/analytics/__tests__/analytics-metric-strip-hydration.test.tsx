// @vitest-environment happy-dom
/**
 * A metric total of 1,000 or more is formatted on the server and again as the
 * page hydrates, in runtimes whose default locales group digits differently
 * ("12,345" and "12.345"). The total must read the same on both sides: the
 * app's locale, which the server resolves and sends with the document.
 */
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { IntlProvider } from 'react-intl'
import { afterEach, describe, expect, it } from 'vitest'
import { restoreRuntimeLocale, setRuntimeLocale } from '@/test/runtime-locale'
import { AnalyticsMetricStrip } from '../analytics-metric-strip'

afterEach(restoreRuntimeLocale)

const strip = (locale: string) => (
  <IntlProvider locale={locale} defaultLocale="en">
    <AnalyticsMetricStrip
      items={[{ key: 'posts', label: 'Posts', color: 'red', value: 12345, delta: null }]}
      activeKey="posts"
      onChange={() => {}}
      gridClassName="grid-cols-1"
    />
  </IntlProvider>
)

async function serverThenHydrate(appLocale: string) {
  setRuntimeLocale('en-US', 'UTC')
  const container = document.createElement('div')
  container.innerHTML = renderToString(strip(appLocale))
  const serverText = container.textContent

  setRuntimeLocale('de-DE', 'Pacific/Kiritimati')
  const errors: unknown[] = []
  await act(async () => {
    hydrateRoot(container, strip(appLocale), {
      onRecoverableError: (error) => errors.push(error),
    })
  })
  return { container, serverText, errors }
}

describe('AnalyticsMetricStrip hydration', () => {
  it('hydrates a large total without error when the browser groups digits differently', async () => {
    const { container, serverText, errors } = await serverThenHydrate('en')

    expect(errors).toEqual([])
    expect(serverText).toContain('12,345')
    expect(container.textContent).toContain('12,345')
  })

  it("formats the total in the app's locale on both sides", async () => {
    const { container, serverText, errors } = await serverThenHydrate('de')

    expect(errors).toEqual([])
    expect(serverText).toContain('12.345')
    expect(container.textContent).toContain('12.345')
  })
})
