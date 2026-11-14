// @vitest-environment happy-dom
/**
 * A note editor's mentions are checked against one inbox item. A host that
 * moves the same editor to another item without remounting it must get an
 * editor built for the new item: TipTap does not re-register an extension's
 * plugins when only the extension list changes, so the old item's typeahead
 * would keep asking about the old item.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'

const { RichTextEditor } = await import('../rich-text-editor')

afterEach(cleanup)

const surface = (container: HTMLElement) => container.querySelector('.ProseMirror')

describe('RichTextEditor mentionItem', () => {
  it('builds a new editor when the mention item changes', async () => {
    const { container, rerender } = render(
      <RichTextEditor value="" mentionItem={{ kind: 'conversation', id: 'conversation_a' }} />
    )
    await waitFor(() => expect(surface(container)).not.toBeNull())
    const first = surface(container)

    rerender(
      <RichTextEditor value="" mentionItem={{ kind: 'conversation', id: 'conversation_b' }} />
    )

    await waitFor(() => expect(surface(container)).not.toBe(first))
  })

  it('keeps the editor when the host re-renders with the same item', async () => {
    const { container, rerender } = render(
      <RichTextEditor value="" mentionItem={{ kind: 'ticket', id: 'ticket_a' }} />
    )
    await waitFor(() => expect(surface(container)).not.toBeNull())
    const first = surface(container)

    rerender(<RichTextEditor value="" mentionItem={{ kind: 'ticket', id: 'ticket_a' }} />)

    expect(surface(container)).toBe(first)
  })
})
