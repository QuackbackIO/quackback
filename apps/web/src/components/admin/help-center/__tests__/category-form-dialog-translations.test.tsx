// @vitest-environment happy-dom
/**
 * The collection editor's Translations section offers the languages the
 * server lists for the collection: the help center's languages less the one
 * its own name is in. A collection left in an old main language gets the main
 * language, and never its own.
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { KbCategoryId } from '@quackback/ids'

vi.mock('@/lib/server/functions/admin', () => ({ listSegmentsFn: vi.fn(async () => []) }))
vi.mock('@/lib/client/queries/help-center', () => ({
  helpCenterQueries: {
    categories: () => ({ queryKey: ['hc', 'categories'], queryFn: async () => [] }),
  },
}))
vi.mock('@/lib/client/mutations/help-center', () => {
  const mutation = () => ({ isPending: false, mutateAsync: async () => ({}) })
  return { useCreateCategory: mutation, useUpdateCategory: mutation }
})
// The select's options open in a portal that happy-dom cannot lay out; a
// plain select stands in for it.
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, children }: { value?: string; children: ReactNode }) => (
    <select value={value ?? ''} onChange={() => {}}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectGroup: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectLabel: () => null,
  SelectSeparator: () => null,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}))
vi.mock('@/lib/server/functions/help-center-translations', () => ({
  getCategoryTranslationStatusesFn: vi.fn(async () => [
    { locale: 'de', status: 'untranslated', updatedAt: null },
    { locale: 'fr', status: 'untranslated', updatedAt: null },
  ]),
  listCategoryTranslationsFn: vi.fn(async () => []),
  upsertCategoryTranslationFn: vi.fn(),
  deleteCategoryTranslationFn: vi.fn(),
}))

import { CategoryFormDialog } from '../category-form-dialog'

afterEach(cleanup)

it('offers the main language and not its own to a collection left in an old main language', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // Main language German; the collection is still in English, now an extra language.
  client.setQueryData(['settings', 'helpCenterConfig'], {
    locales: { default: 'de', additional: ['en', 'fr'] },
  })
  render(
    <QueryClientProvider client={client}>
      <CategoryFormDialog
        open
        onOpenChange={() => {}}
        initialValues={{
          id: 'kb_category_1' as KbCategoryId,
          name: 'Account',
          description: null,
          icon: null,
          isPublic: true,
          segmentIds: [],
          parentId: null,
        }}
      />
    </QueryClientProvider>
  )

  const label = await screen.findByText('Translations')
  const select = label.parentElement!.querySelector('select')!
  await waitFor(() => expect(select).toHaveValue('de'))
  expect([...select.options].map((o) => o.textContent)).toEqual(['Deutsch', 'Français'])
})
