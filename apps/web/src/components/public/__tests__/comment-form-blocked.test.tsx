// @vitest-environment happy-dom
/**
 * A blocked person's comment is refused by the server with the typed `BLOCKED`
 * error. The form says why in the visitor's own language, from the catalogue,
 * rather than the server's English. Any other refusal keeps its old wording.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { PostId } from '@quackback/ids'
import de from '@/locales/de.json'

type Doc = { json(): unknown; html(): string; markdown(): string }

const editor = vi.hoisted(() => ({
  onDocumentChange: null as ((document: Doc) => void) | null,
}))

vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: (props: { onDocumentChange?: (document: Doc) => void }) => {
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

afterEach(cleanup)

const POST_ID = 'post_01h00000000000000000000000' as PostId

/** The error as the browser receives a typed server refusal (typed-error-serialization.ts). */
function typedRefusal(code: string, message: string): Error {
  return Object.assign(new Error(message), { name: 'ForbiddenError', code, statusCode: 403 })
}

async function submitRefused(error: Error, locale: string, messages: Record<string, string>) {
  const mutate = vi.fn((_vars: unknown, opts: { onError: (err: Error) => void }) =>
    opts.onError(error)
  )
  const createComment = { mutate, isPending: false } as unknown as CreateCommentMutation
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale={locale} messages={messages} onError={() => {}}>
        <CommentForm
          postId={POST_ID}
          user={{ name: 'Viewer', email: 'viewer@example.com' }}
          createComment={createComment}
        />
      </IntlProvider>
    </QueryClientProvider>
  )
  fireEvent.pointerEnter(screen.getAllByRole('textbox')[0]!)
  await screen.findByTestId('editor')
  act(() => {
    editor.onDocumentChange!({
      json: () => ({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }],
      }),
      html: () => '<p>Hi</p>',
      markdown: () => 'Hi',
    })
  })
  fireEvent.submit(container.querySelector('form')!)
}

describe('CommentForm when the person is blocked', () => {
  it('shows the blocked line from the catalogue, in the visitor language', async () => {
    await submitRefused(
      typedRefusal('BLOCKED', "You can't post, vote or comment here."),
      'de',
      de as Record<string, string>
    )
    expect(await screen.findByText((de as Record<string, string>)['portal.blocked']!)).toBeTruthy()
    expect(screen.queryByText("You can't post, vote or comment here.")).toBeNull()
  })

  it('keeps the old wording for any other refusal', async () => {
    await submitRefused(typedRefusal('PORTAL_ACCESS_REQUIRED', 'Portal access required'), 'en', {})
    expect(await screen.findByText('Portal access required')).toBeTruthy()
  })
})
