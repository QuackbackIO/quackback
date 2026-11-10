// @vitest-environment happy-dom
/**
 * The conflict notice says who changed the draft and when, so the person
 * knows whose changes they are choosing between.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DraftNotices } from '../draft-notices'

afterEach(cleanup)

type Draft = Parameters<typeof DraftNotices>[0]['draft']
const at = new Date(Date.now() - 2 * 60_000).toISOString()

function notice(conflictChange: unknown) {
  const draft = {
    conflict: true,
    conflictChange,
    refusal: null,
    loadTheirs: async () => {},
    keepMine: async () => {},
  } as unknown as Draft
  render(<DraftNotices draft={draft} />)
  return screen.getByRole('alert').textContent
}

describe('the conflict notice', () => {
  it('names who saved the draft and when', () => {
    expect(notice({ by: 'Sam', at, kind: 'saved' })).toContain('Sam saved the draft 2 minutes ago.')
  })

  it('names a publish, and the person themselves elsewhere', () => {
    expect(notice({ by: 'Sam', at, kind: 'published' })).toContain(
      'Sam published a version 2 minutes ago.'
    )
    cleanup()
    expect(notice({ by: 'You', at, kind: 'saved' })).toContain(
      'You saved the draft somewhere else 2 minutes ago.'
    )
  })

  it('falls back to someone when the change is not known', () => {
    expect(notice(null)).toContain('Someone else changed the draft.')
  })
})

describe('a refused save', () => {
  it('says why, with a way back to the draft the server last saved', () => {
    const recover = vi.fn()
    const draft = { conflict: false, refusal: 'Line 1: @import is not allowed', recover }
    render(<DraftNotices draft={draft as unknown as Draft} />)
    expect(screen.getByRole('alert').textContent).toContain('Line 1: @import is not allowed')
    fireEvent.click(screen.getByRole('button', { name: 'Back to last saved' }))
    expect(recover).toHaveBeenCalledOnce()
  })
})

describe('a design a newer build saved', () => {
  it('says so in one quiet line, and nothing when this build wrote it', () => {
    const draft = { conflict: false, refusal: null, readOnly: true }
    render(<DraftNotices draft={draft as unknown as Draft} />)
    expect(screen.getByRole('status').textContent).toBe(
      'A newer version of Quackback saved this design. Update Quackback to edit it.'
    )
    expect(screen.queryByRole('alert')).toBeNull()
    cleanup()
    render(<DraftNotices draft={{ ...draft, readOnly: false } as unknown as Draft} />)
    expect(screen.queryByRole('status')).toBeNull()
  })
})
