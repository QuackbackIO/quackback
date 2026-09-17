// @vitest-environment happy-dom

import { render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RichTextEditor } from '../rich-text-editor'

describe('RichTextEditor Enter behavior', () => {
  it('starts a new paragraph in a feedback-shaped editor', async () => {
    const onChange = vi.fn()
    const { container } = render(
      <RichTextEditor
        value=""
        onChange={onChange}
        borderless
        toolbarPosition="bottom"
        features={{ images: true, quackbackEmbeds: true }}
        onImageUpload={vi.fn()}
      />
    )

    const editor = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('.ProseMirror')
      expect(element).not.toBeNull()
      return element!
    })

    const user = userEvent.setup()
    await user.click(editor)
    await user.type(editor, 'line one{Enter}line two')

    await waitFor(() => expect(editor.querySelectorAll('p')).toHaveLength(2))
  })
})
