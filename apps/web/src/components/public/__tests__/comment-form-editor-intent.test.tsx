// @vitest-environment happy-dom
/**
 * The comment composer loads the rich-text editor only once someone moves to
 * write. A signed-in reader, or a teammate opening a post to triage it, would
 * otherwise download and mount a full editor for every post they open. The
 * editor module is stubbed to record whether it was loaded.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { PostId } from '@quackback/ids'

const editorModule = vi.hoisted(() => ({ loaded: false }))

vi.mock('@/components/ui/rich-text-editor', () => {
  editorModule.loaded = true
  return {
    RichTextEditor: ({ placeholder }: { placeholder?: string }) => (
      <div data-testid="editor">{placeholder}</div>
    ),
  }
})

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
  useRouteContext: () => ({ session: null }),
}))

import { CommentForm } from '../comment-form'

afterEach(cleanup)

const POST_ID = 'post_01h00000000000000000000000' as PostId

function renderForm(props: Partial<Parameters<typeof CommentForm>[0]> = {}) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={{}} onError={() => {}}>
        <CommentForm
          postId={POST_ID}
          user={{ name: 'Viewer', email: 'viewer@example.com' }}
          {...props}
        />
      </IntlProvider>
    </QueryClientProvider>
  )
}

describe('CommentForm editor', () => {
  it('draws the empty composer without loading the editor', async () => {
    renderForm()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(editorModule.loaded).toBe(false)
    expect(screen.queryByTestId('editor')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Write a comment...' })).toBeTruthy()
  })

  it('mounts the editor once the pointer reaches the composer', async () => {
    renderForm()
    fireEvent.pointerEnter(screen.getByRole('textbox', { name: 'Write a comment...' }))
    expect(await screen.findByTestId('editor')).toBeTruthy()
  })

  it('does the same in the team composer', async () => {
    renderForm({
      isTeamMember: true,
      statuses: [{ id: 'status_1', name: 'Open', color: '#3b82f6' }],
    })
    const standIn = screen.getByRole('textbox', { name: 'Write a comment...' })
    expect(screen.queryByTestId('editor')).toBeNull()
    fireEvent.focus(standIn)
    expect(await screen.findByTestId('editor')).toBeTruthy()
  })
})
