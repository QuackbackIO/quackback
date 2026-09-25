// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

// The editor module stands in for CodeMirror; its factory runs the moment the
// panel imports the chunk, which is what the page must not do on load.
const { editorLoaded } = vi.hoisted(() => ({ editorLoaded: vi.fn() }))
vi.mock('@/components/admin/settings/branding/custom-css-editor', () => {
  editorLoaded()
  return {
    CustomCssEditor: ({ value }: { value: string }) => (
      <textarea data-testid="css-editor" defaultValue={value} />
    ),
  }
})

import { AdvancedCssPanel } from '../advanced-css-panel'

/** Let the lazy import and Suspense settle. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)))

function toggle(details: HTMLDetailsElement, open: boolean) {
  details.open = open
  fireEvent(details, new Event('toggle'))
}

describe('AdvancedCssPanel', () => {
  it('loads the CSS editor only once the panel is opened, then keeps it mounted', async () => {
    const { container } = render(<AdvancedCssPanel value=":root {}" onChange={() => {}} />)
    await settle()

    expect(editorLoaded).not.toHaveBeenCalled()
    expect(screen.queryByTestId('css-editor')).toBeNull()

    const details = container.querySelector('details')!
    act(() => toggle(details, true))
    await settle()

    expect(editorLoaded).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('css-editor')).toBeTruthy()

    // Closing hides the panel but keeps the editor (and what was typed) mounted.
    act(() => toggle(details, false))
    await settle()
    expect(screen.getByTestId('css-editor')).toBeTruthy()
  })
})
