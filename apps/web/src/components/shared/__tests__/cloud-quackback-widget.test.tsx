// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useCloudEnabled: () => true,
  useSessionContext: () => null,
}))

import { CloudQuackbackWidget } from '../cloud-quackback-widget'

afterEach(() => {
  cleanup()
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
