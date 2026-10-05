// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({
  created: [] as unknown[],
  published: [] as unknown[],
  updated: [] as unknown[],
  updateFailures: 0,
  canManage: true,
  publishFailures: 0,
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
    useUpdateArticle: mutation(calls.updated, (input) => {
      if (calls.updateFailures > 0) {
        calls.updateFailures -= 1
        throw new Error('Saving is unavailable')
      }
      return input
    }),
    usePublishArticle: mutation(calls.published, (id) => {
      if (calls.publishFailures > 0) {
        calls.publishFailures -= 1
        throw new Error('Publishing is unavailable')
      }
      return { id }
    }),
  }
})
vi.mock('../help-center-form-fields', () => ({
  HelpCenterFormFields: ({
    form,
    onContentChange,
    error,
  }: {
    form: { setValue: (k: string, v: string) => void }
    onContentChange: (d: { json: () => object; markdown: () => string }) => void
    error?: string
  }) => {
    useEffect(() => {
      form.setValue('title', 'Getting started')
      onContentChange({ json: () => ({ type: 'doc' }), markdown: () => 'Hello' })
    }, [form, onContentChange])
    return (
      <>
        <button
          type="button"
          onClick={() => {
            form.setValue('title', 'Getting started, revised')
            onContentChange({ json: () => ({ type: 'doc', v: 2 }), markdown: () => 'Hello again' })
          }}
        >
          Edit
        </button>
        {error ? <p role="alert">{error}</p> : null}
      </>
    )
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
  calls.publishFailures = 0
  calls.updated.length = 0
  calls.updateFailures = 0
  calls.navigate.mockReset()
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

it('keeps a failed publish in view, and publishes the saved draft on retry', async () => {
  calls.publishFailures = 1
  const onOpenChange = vi.fn()
  render(<CreateArticleDialog open onOpenChange={onOpenChange} />)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Publish' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Saved as a draft, but not published: Publishing is unavailable'
  )
  expect(onOpenChange).not.toHaveBeenCalledWith(false)
  expect(calls.navigate).not.toHaveBeenCalled()

  await user.click(screen.getByRole('button', { name: 'Publish' }))
  await waitFor(() => expect(calls.navigate).toHaveBeenCalledTimes(1))
  // The draft saved the first time: the retry publishes it, never a second copy.
  expect(calls.created).toHaveLength(1)
  expect(calls.published).toEqual(['kb_article_1', 'kb_article_1'])
  expect(onOpenChange).toHaveBeenCalledWith(false)
})

it('saves edits made after a failed publish into the same draft before publishing', async () => {
  calls.publishFailures = 1
  calls.updateFailures = 1
  const onOpenChange = vi.fn()
  render(<CreateArticleDialog open onOpenChange={onOpenChange} />)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Publish' }))
  await screen.findByRole('alert')

  await user.click(screen.getByRole('button', { name: 'Edit' }))
  // The save of the edits fails: the dialog stays open with the error, nothing published.
  await user.click(screen.getByRole('button', { name: 'Publish' }))
  expect(await screen.findByText(/Saving is unavailable/)).toBeInTheDocument()
  expect(calls.published).toEqual(['kb_article_1'])
  expect(calls.navigate).not.toHaveBeenCalled()

  await user.click(screen.getByRole('button', { name: 'Publish' }))
  await waitFor(() => expect(calls.navigate).toHaveBeenCalledTimes(1))
  expect(calls.created).toHaveLength(1)
  expect(calls.updated.at(-1)).toMatchObject({
    id: 'kb_article_1',
    title: 'Getting started, revised',
    content: 'Hello again',
    contentJson: { type: 'doc', v: 2 },
  })
  expect(calls.published).toEqual(['kb_article_1', 'kb_article_1'])
  expect(onOpenChange).toHaveBeenCalledWith(false)
})
