// @vitest-environment happy-dom
/**
 * Ctrl+K opens quick find, from the designer or its canvas; choosing a
 * setting selects its part, on a page that has it, and focuses its control.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { outlineOf } from '@/lib/shared/design/outline'
import { defaultDesign } from '@/lib/shared/design/schema'
import { blockFindActions, type FindItem } from '@/lib/shared/design/quick-find'
import { QuickFind, revealSetting } from '../quick-find'

const events = vi.hoisted(() => ({ trackBuilder: vi.fn() }))
vi.mock('@/lib/client/builder-events', () => events)

afterEach(() => {
  cleanup()
  events.trackBuilder.mockClear()
})

function show(actions?: () => FindItem[]) {
  const onSelect = vi.fn()
  const onPage = vi.fn()
  render(
    <QuickFind
      nodes={outlineOf(defaultDesign(), 'roadmap')}
      page="roadmap"
      pages={['feedback', 'roadmap']}
      onSelect={onSelect}
      onPage={onPage}
      actions={actions}
    />
  )
  return { onSelect, onPage }
}

describe('QuickFind', () => {
  it('opens on Ctrl+K and leads a setting to its part, on its page', async () => {
    const { onSelect, onPage } = show()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    fireEvent.change(await screen.findByPlaceholderText('Find a block, page, setting or action…'), {
      target: { value: 'default sort' },
    })
    fireEvent.click(await screen.findByText('Default sort'))
    expect(onPage).toHaveBeenCalledWith('feedback')
    expect(onSelect).toHaveBeenCalledWith('feed')
  })

  it('does an action, read as it opens, and closes', async () => {
    const duplicate = vi.fn()
    const actions = vi.fn(() =>
      blockFindActions({
        picked: 'Top posts',
        onAdd: vi.fn(),
        onLayouts: vi.fn(),
        onDuplicate: duplicate,
        onRemove: vi.fn(),
      })
    )
    show(actions)
    expect(actions).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    fireEvent.change(await screen.findByPlaceholderText('Find a block, page, setting or action…'), {
      target: { value: 'duplicate' },
    })
    fireEvent.click(await screen.findByText('Duplicate Top posts'))
    expect(duplicate).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('counts each time it opens, once', async () => {
    show()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    await screen.findByPlaceholderText('Find a block, page, setting or action…')
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(events.trackBuilder.mock.calls).toEqual([
      ['designer_panel_opened', { panel: 'quick_find' }],
    ])
  })

  it('opens when the canvas hands over its Ctrl+K, and not for another origin', async () => {
    show()
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'quackback:preview-key', key: 'find' },
          origin: 'https://elsewhere.example.com',
        })
      )
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'quackback:preview-key', key: 'find' },
          origin: window.location.origin,
        })
      )
    })
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })
})

describe('revealSetting', () => {
  it('focuses the control under the label once the settings draw it', async () => {
    const settings = document.createElement('aside')
    settings.id = 'designer-settings'
    document.body.append(settings)
    Element.prototype.scrollIntoView = vi.fn()
    revealSetting('Favicon')
    // The part's settings draw a moment later.
    settings.innerHTML = '<label for="fav">Favicon</label><input id="fav" />'
    await waitFor(() => expect(document.activeElement?.id).toBe('fav'))
    settings.remove()
  })

  it('opens Advanced when the setting is under it', async () => {
    const settings = document.createElement('aside')
    settings.id = 'designer-settings'
    settings.innerHTML =
      '<details><summary>Advanced</summary><label for="css">Custom CSS</label><textarea id="css"></textarea></details>'
    document.body.append(settings)
    Element.prototype.scrollIntoView = vi.fn()
    revealSetting('Custom CSS')
    await waitFor(() => expect(settings.querySelector('details')!.open).toBe(true))
    settings.remove()
  })
})
