// @vitest-environment happy-dom
/**
 * Writing a post's details is the editor's work alone: a keystroke must not
 * re-render the widget home around the editor. The post still carries exactly
 * what was typed (or what the host prefilled), and the composer still closes
 * when its title is cleared with no details written. The editor is a stub that
 * counts its renders (it is not memoized, so it renders whenever its host
 * does) and hands the test its change callbacks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { WidgetHomeProps } from '../widget-home-animated'

type Doc = { json(): unknown; html(): string; markdown(): string }

const { createPost, editor } = vi.hoisted(() => ({
  createPost: vi.fn(),
  editor: {
    renders: 0,
    value: undefined as unknown,
    onChange: null as ((json: unknown, html: string, markdown: string) => void) | null,
    onDocumentChange: null as ((document: Doc) => void) | null,
  },
}))

vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => ({
    ensureSession: async () => true,
    ensureSessionThen: async (cb: () => void | Promise<void>) => cb(),
    isIdentified: true,
    hmacRequired: true,
    user: { name: 'Ada Example', email: 'ada@example.com' },
    emitEvent: vi.fn(),
    metadata: null,
    getSessionVersion: () => 1,
    sessionVersion: 1,
  }),
}))
vi.mock('@/lib/client/widget-auth', () => ({
  getWidgetAuthHeaders: () => ({ Authorization: 'Bearer test' }),
}))
vi.mock('@/lib/client/widget-bridge', () => ({ sendToHost: vi.fn() }))
vi.mock('../use-widget-image-upload', () => ({
  useWidgetMediaUpload: () => ({ upload: vi.fn() }),
  WidgetSessionError: class WidgetSessionError extends Error {},
}))
vi.mock('../widget-vote-button', () => ({ WidgetVoteButton: () => null }))
vi.mock('framer-motion', async () => {
  const { createElement, forwardRef } = await import('react')
  const MOTION_PROPS = new Set(['initial', 'animate', 'exit', 'transition', 'variants', 'layout'])
  const make = (tag: string) =>
    forwardRef<HTMLElement, Record<string, unknown>>((props, ref) => {
      const { children, ...rest } = props
      const dom: Record<string, unknown> = { ref }
      for (const [key, value] of Object.entries(rest)) {
        if (!MOTION_PROPS.has(key)) dom[key] = value
      }
      return createElement(tag, dom, children as ReactNode)
    })
  const proxy = new Proxy(
    {},
    { get: (_target, prop) => (typeof prop === 'string' ? make(prop) : undefined) }
  )
  return {
    AnimatePresence: ({ children }: { children?: ReactNode }) => children,
    motion: proxy,
    m: proxy,
    useReducedMotion: () => true,
  }
})
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: (props: {
    value?: unknown
    onChange?: typeof editor.onChange
    onDocumentChange?: typeof editor.onDocumentChange
  }) => {
    editor.renders++
    editor.value = props.value
    editor.onChange = props.onChange ?? null
    editor.onDocumentChange = props.onDocumentChange ?? null
    return <div data-testid="editor" />
  },
}))
vi.mock('@/components/ui/select', async () => import('@/test/radix-select'))
vi.mock('@/lib/server/functions/widget/posts', () => ({
  widgetListPublicPostsFn: vi.fn(async () => ({ items: [], hasMore: false, total: 0 })),
  widgetCreatePublicPostFn: (...args: unknown[]) => createPost(...args),
}))

import { WidgetHomeAnimated } from '../widget-home-animated'

const ideas = { id: 'board_ideas', name: 'Feature Requests', slug: 'feature-requests-1' }

function renderHome(props: Partial<WidgetHomeProps> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <IntlProvider locale="en">
        <WidgetHomeAnimated
          initialPosts={[]}
          statuses={[]}
          boards={[ideas]}
          boardPermissions={{ [ideas.id]: { canSubmit: true, canVote: true } }}
          defaultBoard="feature-requests-1"
          confirmedBoardSlugs={['feature-requests-1']}
          {...props}
        />
      </IntlProvider>
    </QueryClientProvider>
  )
}

function typeTitle(value: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Feedback title' }), {
    target: { value },
  })
}

function paragraph(text: string) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

/** Feed the editor's change callback one character at a time. */
function typeDetails(text: string) {
  for (let i = 1; i <= text.length; i++) {
    const typed = text.slice(0, i)
    const json = paragraph(typed)
    const html = `<p>${typed}</p>`
    act(() => {
      if (editor.onDocumentChange) {
        editor.onDocumentChange({ json: () => json, html: () => html, markdown: () => typed })
      } else {
        editor.onChange!(json, html, typed)
      }
    })
  }
}

beforeEach(() => {
  createPost.mockReset()
  createPost.mockResolvedValue({
    id: 'post_1',
    title: 'Dark mode',
    voteCount: 1,
    statusId: null,
    board: ideas,
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ data: { posts: [] } }) }))
  )
})

afterEach(() => {
  cleanup()
  editor.renders = 0
  editor.onChange = null
  editor.onDocumentChange = null
})

describe('widget home post composer', () => {
  it('does not re-render the composer per keystroke in the details', async () => {
    renderHome()
    typeTitle('Dark mode')
    await screen.findByTestId('editor')

    editor.renders = 0
    typeDetails('Please add it')
    expect(editor.renders).toBe(0)
  })

  it('posts the details as typed', async () => {
    renderHome()
    typeTitle('Dark mode')
    await screen.findByTestId('editor')
    typeDetails('Please add it')

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => expect(createPost).toHaveBeenCalledTimes(1))
    expect(createPost.mock.calls[0]![0]).toMatchObject({
      data: {
        title: 'Dark mode',
        content: '<p>Please add it</p>',
        contentJson: paragraph('Please add it'),
      },
    })
  })

  it('posts the body the host prefilled', async () => {
    renderHome({ composeRequest: { nonce: 1, title: 'Dark mode', body: 'From the host' } })
    await screen.findByTestId('editor')
    expect(editor.value).toEqual(paragraph('From the host'))

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => expect(createPost).toHaveBeenCalledTimes(1))
    expect(createPost.mock.calls[0]![0]).toMatchObject({
      data: {
        title: 'Dark mode',
        content: '<p>From the host</p>',
        contentJson: paragraph('From the host'),
      },
    })
  })

  it('closes when the title is cleared before any details are written', async () => {
    renderHome()
    typeTitle('Dark mode')
    await screen.findByTestId('editor')

    typeTitle('')
    expect(screen.queryByTestId('editor')).toBeNull()
  })

  it('stays open when the title is cleared after details were written', async () => {
    renderHome()
    typeTitle('Dark mode')
    await screen.findByTestId('editor')
    typeDetails('Please')

    typeTitle('')
    expect(screen.getByTestId('editor')).toBeTruthy()
  })
})
