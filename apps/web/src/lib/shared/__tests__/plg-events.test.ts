import { describe, expect, it } from 'vitest'
import { parsePlgEventInput } from '../plg-events'

describe('PLG event allowlist', () => {
  it('accepts the bounded activation vocabulary', () => {
    expect(
      parsePlgEventInput({
        name: 'activation_cta_clicked',
        outcome: 'product_feedback',
        surface: 'feedback_empty',
        actionId: 'copy-board-link',
        artifactType: 'board',
      })
    ).toEqual({
      name: 'activation_cta_clicked',
      outcome: 'product_feedback',
      surface: 'feedback_empty',
      actionId: 'copy-board-link',
      artifactType: 'board',
    })
  })

  it.each(['email', 'url', 'token', 'content'])('rejects the forbidden %s field', (key) => {
    expect(parsePlgEventInput({ name: 'trial_started', [key]: 'secret' })).toBeNull()
  })

  it('rejects unknown events and unbounded action ids', () => {
    expect(parsePlgEventInput({ name: 'page_viewed' })).toBeNull()
    expect(
      parsePlgEventInput({ name: 'activation_cta_clicked', actionId: 'https://secret' })
    ).toBeNull()
  })
})

describe('PLG event outcomes', () => {
  it.each(['status_page', 'internal'])('accepts the %s outcome', (outcome) => {
    expect(parsePlgEventInput({ name: 'first_win_reached', outcome })).toEqual({
      name: 'first_win_reached',
      outcome,
    })
  })
})
