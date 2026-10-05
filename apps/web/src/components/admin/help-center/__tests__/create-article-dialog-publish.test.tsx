// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({
  created: [] as unknown[],
  published: [] as unknown[],
  canManage: true,
  navigate: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => calls.navigate,
  useRouteContext: ({ select }: { select: (c: unknown) => unknown }) =>
    select({ permissions: calls.canManage ? ['help_center.manage'] : [] }),
}))
vi.mock('@/lib/client/mutations/help-center', () => {
  const mutation = (record: unknown[], result: (input: unknown) => unknown) => () => ({
    isPending: false,
    isError: false,
    error: null,
    reset: () => {},
    mutateAsync: async (input: unknown) => {
      record.push(input)
      return result(input)
    },
  })
  return {
    useCreateArticle: mutation(calls.created, () => ({ id: 'kb_article_1' })),
    usePublishArticle: mutation(calls.published, (id) => ({ id })),
  }
})
vi.mock('../help-center-form-fields', () => ({
  HelpCenterFormFields: ({
    form,
    onContentChange,
  }: {
    form: { setValue: (k: string, v: string) => void }
    onContentChange: (d: { json: () => object; markdown: () => string }) => void
  }) => {
    useEffect(() => {
      form.setValue('title', 'Getting started')
      onContentChange({ json: () => ({ type: 'doc' }), markdown: () => 'Hello' })
    }, [form, onContentChange])
    return null
  },
}))
vi.mock('../help-center-metadata-sidebar', () => ({
  HelpCenterMetadataSidebar: () => null,
  HelpCenterMetadataSidebarContent: () => null,
}))

import { CreateArticleDialog } from '../create-article-dialog'

afterEach(() => {
  cleanup()
  calls.created.length = 0
  calls.published.length = 0
  calls.canManage = true
})

it('publishes the new article in one step', async () => {
  render(<CreateArticleDialog open onOpenChange={() => {}} />)
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Publish' }))
  await waitFor(() => expect(calls.published).toEqual(['kb_article_1']))
  expect(calls.created).toHaveLength(1)
})

it('saves a draft without publishing it', async () => {
  render(<CreateArticleDialog open onOpenChange={() => {}} />)
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Save draft' }))
  await waitFor(() => expect(calls.created).toHaveLength(1))
  expect(calls.published).toEqual([])
})

it('offers Publish only to someone who may publish', async () => {
  calls.canManage = false
  render(<CreateArticleDialog open onOpenChange={() => {}} />)
  expect(await screen.findByRole('button', { name: 'Save draft' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull()
})
