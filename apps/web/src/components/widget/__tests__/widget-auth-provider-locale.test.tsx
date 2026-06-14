// @vitest-environment happy-dom
/**
 * Regression coverage for issue #133 (React minified error #418).
 *
 * WidgetAuthProvider derived its initial locale from `navigator.language`
 * inside the useState initializer. The server has no `navigator`, so SSR
 * rendered the widget in DEFAULT_LOCALE while the client hydrated in the
 * visitor's browser language — a hydration mismatch for every non-English
 * visitor. The locale must come solely from the SSR-resolved prop.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useIntl } from 'react-intl'

vi.mock('@/lib/client/widget-auth', () => ({
  setWidgetToken: vi.fn(),
  clearWidgetToken: vi.fn(),
  getWidgetToken: vi.fn(() => null),
  persistAnonymousToken: vi.fn(),
  readPersistedToken: vi.fn(() => null),
  clearPersistedToken: vi.fn(),
}))
vi.mock('@/lib/client/widget-bridge', () => ({ sendToHost: vi.fn() }))
vi.mock('@/lib/client/auth-client', () => ({
  authClient: { signIn: { anonymous: vi.fn().mockResolvedValue({ data: null, error: null }) } },
}))
vi.mock('@/lib/shared/i18n', async (orig) => ({
  ...(await orig<typeof import('@/lib/shared/i18n')>()),
  loadMessages: vi.fn().mockResolvedValue({}),
}))

import { WidgetAuthProvider } from '../widget-auth-provider'

function LocaleProbe() {
  return <span data-testid="locale">{useIntl().locale}</span>
}

function renderWidget(initialLocale?: 'en' | 'de' | 'fr') {
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <WidgetAuthProvider initialLocale={initialLocale}>
        <LocaleProbe />
      </WidgetAuthProvider>
    </QueryClientProvider>
  )
}

describe('WidgetAuthProvider locale (hydration safety #133)', () => {
  beforeEach(() => {
    // A non-English browser — the trigger for the original bug.
    Object.defineProperty(navigator, 'language', { value: 'fr-FR', configurable: true })
  })

  it('uses the SSR-resolved initialLocale prop', () => {
    expect(renderWidget('de').getByTestId('locale').textContent).toBe('de')
  })

  it('falls back to DEFAULT_LOCALE, never navigator.language, when no locale is provided', () => {
    // Pre-fix this fell through to navigator.language ('fr'), so a French
    // browser hydrated a French tree over an English SSR tree → React #418.
    expect(renderWidget().getByTestId('locale').textContent).toBe('en')
  })
})
