// @vitest-environment happy-dom
/**
 * Typing a comment is the editor's work alone: a keystroke must not re-render
 * the form around the editor. The form still posts exactly what was typed, and
 * once a submit has shown a validation message it re-checks on every change so
 * the message clears as soon as the comment is valid. Until then a keystroke
 * serializes nothing: the comment's markdown is read when it is sent. The
 * editor module is stubbed: it counts its renders and hands the test its
 * change callback.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { PostId } from '@quackback/ids'

type OnChange = (json: unknown, html: string, markdown: string) => void
type Doc = { json(): unknown; html(): string; markdown(): string }

const editor = vi.hoisted(() => ({
  renders: 0,
  onChange: null as OnChange | null,
  onDocumentChange: null as ((document: Doc) => void) | null,
  /** Markdown serializations: every onChange call, or a document's markdown read. */
  serialized: 0,
}))

vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: (props: { onChange?: OnChange; onDocumentChange?: (document: Doc) => void }) => {
    editor.renders++
    editor.onChange = props.onChange ?? null
    editor.onDocumentChange = props.onDocumentChange ?? null
    return <div data-testid="editor" />
  },
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
  useRouteContext: (opts?: { select?: (context: never) => unknown }) => {
    const context = { session: null }
    return opts?.select ? opts.select(context as never) : context
  },
}))

import { CommentForm, type CreateCommentMutation } from '../comment-form'

afterEach(() => {
  cleanup()
  editor.serialized = 0
})

const POST_ID = 'post_01h00000000000000000000000' as PostId

function doc(text: string) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

async function renderForm(props: Partial<Parameters<typeof CommentForm>[0]> = {}) {
  const mutate = vi.fn()
  const createComment = { mutate, isPending: false } as unknown as CreateCommentMutation
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={{}} onError={() => {}}>
        <CommentForm
          postId={POST_ID}
          user={{ name: 'Viewer', email: 'viewer@example.com' }}
          createComment={createComment}
          {...props}
        />
      </IntlProvider>
    </QueryClientProvider>
  )
  fireEvent.pointerEnter(screen.getByRole('textbox', { name: 'Write a comment...' }))
  await screen.findByTestId('editor')
  return { mutate }
}

/** Feed the editor's change callback one character at a time. */
function type(text: string) {
  for (let i = 1; i <= text.length; i++) {
    const typed = text.slice(0, i)
    act(() => {
      if (editor.onDocumentChange) {
        editor.onDocumentChange({
          json: () => doc(typed),
          html: () => `<p>${typed}</p>`,
          markdown: () => {
            editor.serialized++
            return typed
          },
        })
      } else {
        editor.serialized++
        editor.onChange!(doc(typed), '', typed)
      }
    })
  }
}

describe('CommentForm typing', () => {
  it.each([
    ['comment composer', {}],
    [
      'team composer',
      { isTeamMember: true, statuses: [{ id: 'status_1', name: 'Open', color: '#3b82f6' }] },
    ],
  ])('does not re-render the %s per keystroke', async (_name, props) => {
    await renderForm(props)
    editor.renders = 0
    type('Hello there')
    expect(editor.renders).toBe(0)
  })

  it('serializes the comment once, when it is sent', async () => {
    const { mutate } = await renderForm()
    type('Hello there')
    expect(editor.serialized).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))
    expect(editor.serialized).toBe(1)
  })

  it('posts what was typed', async () => {
    const { mutate } = await renderForm()
    type('Hello there')
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))
    expect(mutate.mock.calls[0]![0]).toMatchObject({
      content: 'Hello there',
      contentJson: doc('Hello there'),
    })
  })

  it('clears the validation message as soon as the comment is valid', async () => {
    const { mutate } = await renderForm()
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
    expect(await screen.findByText('Comment is required')).toBeTruthy()

    type('H')
    await waitFor(() => expect(screen.queryByText('Comment is required')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))
    expect(mutate.mock.calls[0]![0]).toMatchObject({ content: 'H' })
  })
})
