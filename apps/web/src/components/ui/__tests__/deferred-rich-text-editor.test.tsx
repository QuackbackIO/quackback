// @vitest-environment happy-dom
/**
 * DeferredRichTextEditor stands in for the editor until someone moves to
 * write, so reading a page never loads the editor module. The module is
 * stubbed to record whether it was loaded and what each mounted editor got.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

const editorModule = vi.hoisted(() => ({ loaded: false, mounts: [] as unknown[] }))

vi.mock('../rich-text-editor', () => {
  editorModule.loaded = true
  return {
    RichTextEditor: (props: { autofocus?: unknown; placeholder?: string }) => {
      editorModule.mounts.push(props.autofocus)
      return <div data-testid="editor" data-autofocus={String(props.autofocus)} />
    },
  }
})

import { DeferredRichTextEditor } from '../lazy-rich-text-editor'

afterEach(cleanup)

describe('DeferredRichTextEditor', () => {
  it('shows the empty editor without loading the editor', async () => {
    render(<DeferredRichTextEditor placeholder="Write a comment..." minHeight="80px" />)
    expect(screen.getByRole('textbox', { name: 'Write a comment...' })).toBeTruthy()
    expect(screen.getByText('Write a comment...')).toBeTruthy()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(editorModule.loaded).toBe(false)
    expect(screen.queryByTestId('editor')).toBeNull()
  })

  it('mounts the editor, unfocused, when the pointer arrives', async () => {
    render(<DeferredRichTextEditor placeholder="Write a comment..." />)
    fireEvent.pointerEnter(screen.getByRole('textbox'))
    expect((await screen.findByTestId('editor')).dataset.autofocus).toBe('undefined')
  })

  it('mounts the editor focused on a press or keyboard focus', async () => {
    render(<DeferredRichTextEditor placeholder="Write a comment..." />)
    fireEvent.focus(screen.getByRole('textbox'))
    expect((await screen.findByTestId('editor')).dataset.autofocus).toBe('end')
  })

  it('remounts unfocused after a reset', async () => {
    const { rerender } = render(<DeferredRichTextEditor editorKey={0} placeholder="Write" />)
    fireEvent.pointerDown(screen.getByRole('textbox'))
    expect((await screen.findByTestId('editor')).dataset.autofocus).toBe('end')

    rerender(<DeferredRichTextEditor editorKey={1} placeholder="Write" />)
    expect((await screen.findByTestId('editor')).dataset.autofocus).toBe('undefined')
  })
})
