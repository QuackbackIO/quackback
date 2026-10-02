// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Suspense } from 'react'
import { cleanup, render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useRouter: () => ({ invalidate: () => {}, navigate: () => {} }),
  Link: ({ children }: { children: unknown }) => children,
}))

const { INTEGRATION_SETTINGS } = await import('../integration-settings-registry')

afterEach(cleanup)

/** Connect steps name the button the admin clicks, so the two cannot drift. */
describe('integration connect config', () => {
  const typedInput = async (type: string) => {
    const entry = INTEGRATION_SETTINGS[type]
    const { container, findByText } = render(
      <QueryClientProvider client={new QueryClient()}>
        <Suspense fallback={<p>loading</p>}>
          <entry.ConnectionActions integrationId={undefined} isConnected={false} />
        </Suspense>
        <p>mounted</p>
      </QueryClientProvider>
    )
    await waitFor(() => expect(container.textContent).not.toContain('loading'), {
      timeout: 20000,
    })
    await findByText('mounted')
    const has = container.querySelector('input:not([type="hidden"])') !== null
    cleanup()
    return has
  }

  it('flags connectForm exactly for providers whose connect needs typed input', async () => {
    const mismatched: string[] = []
    for (const type of Object.keys(INTEGRATION_SETTINGS)) {
      const typed = await typedInput(type)
      if (typed !== (INTEGRATION_SETTINGS[type].connectForm === true)) mismatched.push(type)
    }
    expect(mismatched).toEqual([])
  }, 120000)

  it('setup steps never point at a bare "Connect" button unless the button reads that', () => {
    const offenders = Object.entries(INTEGRATION_SETTINGS)
      .filter(([, entry]) =>
        entry.setup.steps.some((step) => />Connect<\/span>/.test(renderToStaticMarkup(<>{step}</>)))
      )
      .map(([type]) => type)
    // Azure DevOps is the one connect button that reads just "Connect".
    expect(offenders).toEqual(['azure_devops'])
  })
})
