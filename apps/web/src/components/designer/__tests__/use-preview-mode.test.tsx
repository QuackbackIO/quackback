// @vitest-environment happy-dom
/**
 * Leaving Preview hands focus back to the Preview button, however it was
 * left: from the top bar, or by an Escape the frame passed on.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { usePreviewMode } from '../use-preview-mode'

afterEach(cleanup)

let mode: ReturnType<typeof usePreviewMode>
function Builder() {
  mode = usePreviewMode()
  return mode.previewing ? (
    <button type="button">Back to editing</button>
  ) : (
    <button type="button" data-preview="">
      Preview
    </button>
  )
}

describe('usePreviewMode', () => {
  it('focuses Preview once the top bar is back, even when left outside a React event', () => {
    render(<Builder />)
    act(() => mode.enter())
    expect(mode.previewing).toBe(true)
    // A message from the frame: not a React event, so nothing is drawn yet when it is handled.
    act(() => mode.leave())
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Preview' }))
  })

  it('leaves focus alone when Preview was never left', () => {
    render(<Builder />)
    expect(document.activeElement).toBe(document.body)
  })
})
