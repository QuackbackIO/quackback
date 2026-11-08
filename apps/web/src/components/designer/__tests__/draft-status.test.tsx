// @vitest-environment happy-dom
/**
 * The draft status: how many changes are not live, as a menu that sees every
 * change, discards the draft only after asking, and keeps what the old More
 * menu held: versions, a preview link and find.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { DesignCheck } from '@/lib/shared/design/checks'
import { DraftStatus } from '../draft-status'

afterEach(cleanup)

function show(count = 4, checks: DesignCheck[] = []) {
  const handlers = {
    onShowCheck: vi.fn(),
    onFixCheck: vi.fn(),
    onSeeAll: vi.fn(),
    onDiscard: vi.fn(),
    onVersions: vi.fn(),
    onShare: vi.fn(),
    onFind: vi.fn(),
  }
  render(
    <DraftStatus
      count={count}
      saving={false}
      failed={false}
      blocked={false}
      published
      checks={checks}
      {...handlers}
    />
  )
  return handlers
}

async function open() {
  const trigger = screen.getByRole('button', { name: /changes, not live|No changes/ })
  act(() => trigger.focus())
  fireEvent.keyDown(trigger, { key: 'ArrowDown' })
  return screen.findByRole('menuitem', { name: 'See every change' })
}

describe('the draft status', () => {
  it('counts the changes not live yet, and sees every change', async () => {
    const { onSeeAll } = show()
    expect(screen.getByRole('button', { name: '4 changes, not live' })).toBeTruthy()
    fireEvent.click(await open())
    expect(onSeeAll).toHaveBeenCalledOnce()
  })

  it('asks before discarding the draft', async () => {
    const { onDiscard } = show()
    await open()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Discard draft' }))
    expect(onDiscard).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toContain('Discard the draft?')
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
    expect(onDiscard).toHaveBeenCalledOnce()
  })

  it('keeps versions, sharing a preview link and find', async () => {
    const { onVersions } = show()
    await open()
    expect(screen.getByRole('menuitem', { name: /Share a preview link/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /Find a setting/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Versions' }))
    expect(onVersions).toHaveBeenCalledOnce()
  })

  it('counts the things to check, each leading to the part that fixes it', async () => {
    const { onShowCheck } = show(2, [
      { id: 'band-alt', text: 'The hero image has no description.', part: 'hero' },
    ])
    await open()
    expect(screen.getByText('1 thing to check')).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: /hero image has no description/ }))
    expect(onShowCheck).toHaveBeenCalledWith('hero')
  })

  it('fixes a check that has a fix in one step', async () => {
    const check: DesignCheck = {
      id: 'light-panel-postCard',
      text: 'Post cards stay light in dark mode.',
      part: 'site:styles',
      fix: { label: 'Use the card colour', apply: () => {} },
    }
    const { onFixCheck, onShowCheck } = show(2, [check])
    await open()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Use the card colour' }))
    expect(onFixCheck).toHaveBeenCalledWith(check)
    expect(onShowCheck).not.toHaveBeenCalled()
  })
})
