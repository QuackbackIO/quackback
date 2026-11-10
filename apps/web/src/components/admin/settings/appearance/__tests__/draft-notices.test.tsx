// @vitest-environment happy-dom
/**
 * The conflict notice says who changed the draft and when, so the person
 * knows whose changes they are choosing between.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
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
