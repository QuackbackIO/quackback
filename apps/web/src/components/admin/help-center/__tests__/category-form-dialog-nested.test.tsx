// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'

const created = vi.hoisted(() => [] as unknown[])

vi.mock('@/lib/server/functions/admin', () => ({ listSegmentsFn: vi.fn(async () => []) }))
vi.mock('@/lib/client/queries/help-center', () => ({
  helpCenterQueries: {
    categories: () => ({ queryKey: ['hc', 'categories'], queryFn: async () => [] }),
  },
}))
vi.mock('@/lib/client/mutations/help-center', () => {
  const mutation = () => ({
    isPending: false,
    mutateAsync: async (input: unknown) => {
      created.push(input)
      return { id: 'kb_category_1' }
    },
  })
  return { useCreateCategory: mutation, useUpdateCategory: mutation }
})

import { CategoryFormDialog } from '../category-form-dialog'

afterEach(() => {
  cleanup()
  created.length = 0
})

it('creates the category without submitting the article form it sits in', async () => {
  const outerSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
  const onCreated = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <form onSubmit={outerSubmit}>
        <CategoryFormDialog open onOpenChange={() => {}} onCreated={onCreated} />
      </form>
    </QueryClientProvider>
  )

  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Name'), 'Billing')
  await user.keyboard('{Enter}')

  await waitFor(() => expect(onCreated).toHaveBeenCalledWith('kb_category_1'))
  expect(created).toHaveLength(1)
  expect(outerSubmit).not.toHaveBeenCalled()
})
