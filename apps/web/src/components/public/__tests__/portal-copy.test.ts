/** Visitor copy reads one way: a real ellipsis, and sentence case for actions and states. */
import { describe, expect, it } from 'vitest'
import en from '@/locales/en.json'

const portal = Object.entries(en as Record<string, string>).filter(([key]) =>
  key.startsWith('portal.')
)

describe('portal copy', () => {
  it('uses "…", never three dots', () => {
    expect(portal.filter(([, text]) => text.includes('...')).map(([key]) => key)).toEqual([])
  })

  it('writes actions and states in sentence case', () => {
    const copy = en as Record<string, string>
    expect(copy['portal.feedback.empty.comingSoonTitle']).toBe('Coming soon')
    expect(copy['portal.postCard.quickActions.viewInPortal']).toBe('View in portal')
    expect(copy['portal.postCard.quickActions.copyLink']).toBe('Copy link')
  })
})
