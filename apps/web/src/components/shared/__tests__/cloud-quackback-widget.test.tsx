// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useCloudEnabled: () => true,
  useSessionContext: () => null,
}))

import { CloudQuackbackWidget } from '../cloud-quackback-widget'

beforeEach(() => {
  const append = document.head.appendChild.bind(document.head)
  vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
    // Exercise installation and queuing without asking happy-dom to load a remote SDK.
    if (node instanceof HTMLScriptElement) node.type = 'application/x-test-sdk'
    return append(node)
  })
})

afterEach(() => {
  cleanup()
  document.querySelector('script[src="https://feedback.quackback.io/api/widget/sdk.js"]')?.remove()
  vi.restoreAllMocks()
  delete (window as { Quackback?: unknown }).Quackback
})

it('starts the help launcher in the team member language', () => {
  render(
    <IntlProvider locale="de" messages={{}}>
      <CloudQuackbackWidget />
    </IntlProvider>
  )
  const queue = (window.Quackback as unknown as { q: unknown[][] }).q
  expect(queue).toContainEqual(['init', { locale: 'de' }])
})
