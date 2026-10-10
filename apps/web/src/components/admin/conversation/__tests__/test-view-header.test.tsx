// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

afterEach(cleanup)

const deleteTestConversationsFn = vi.hoisted(() => vi.fn(async () => ({ deleted: 2 })))
vi.mock('@/lib/server/functions/test-customer', () => ({ deleteTestConversationsFn }))

const { TestViewHeader } = await import('../test-view-header')

function renderHeader(onDeleted = vi.fn()) {
  const client = new QueryClient()
  render(
    <QueryClientProvider client={client}>
      <IntlProvider locale="en">
        <TestViewHeader onDeleted={onDeleted} />
      </IntlProvider>
    </QueryClientProvider>
  )
  return onDeleted
}

describe('TestViewHeader', () => {
  it('deletes test conversations only after confirming', async () => {
    const user = userEvent.setup()
    const onDeleted = renderHeader()
    await user.click(screen.getByRole('button', { name: 'Delete test conversations' }))
    expect(deleteTestConversationsFn).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(onDeleted).toHaveBeenCalled())
    expect(deleteTestConversationsFn).toHaveBeenCalledTimes(1)
  })
})
