/**
 * The router reads a request's scope from its words: one part ("just this
 * button"), one page ("only on the roadmap page"), phones ("on phones"). A
 * request scoped so takes one call, whose override operation says exactly
 * where; the loop reads every page's look, which an override is not.
 */
import { describe, expect, it } from 'vitest'
import { routeRequest, scopeOf, scopeNote } from '../router'
import { STYLE_REGISTRY } from '../style-registry'

describe('the scope a request names', () => {
  it('reads one page', () => {
    expect(scopeOf('Only on the roadmap page, make the buttons round').page).toBe('roadmap')
    expect(scopeOf('Give the cards on the changelog a shadow, just there').page).toBe('changelog')
    expect(scopeOf('On the help center only, links in the second colour').page).toBe('help')
    expect(scopeOf('Make the buttons round').page).toBeUndefined()
    // A page named as what the change is about, not where.
    expect(scopeOf('Move the roadmap block to the top').page).toBeUndefined()
  })

  it('reads phones', () => {
    expect(scopeOf('On phones, make the headline smaller').phone).toBe(true)
    expect(scopeOf('Make the buttons taller on mobile').phone).toBe(true)
    expect(scopeOf('Make the buttons taller').phone).toBe(false)
    // The Mobile board is no screen.
    expect(scopeOf('Show posts from the Mobile board').phone).toBe(false)
  })

  it('reads one of a kind', () => {
    expect(scopeOf('Make just this button black').one).toBe(true)
    expect(scopeOf('Make the hero’s call to action black but leave the other buttons').one).toBe(
      true
    )
    expect(scopeOf('Only this one should be bigger').one).toBe(true)
    expect(scopeOf('Make the buttons black').one).toBe(false)
  })

  it('says what it read, for the model', () => {
    expect(scopeNote('Only on the roadmap page, make the buttons round')).toMatch(/page:roadmap/)
    expect(scopeNote('On phones, make the headline smaller')).toMatch(/phone\./)
    expect(scopeNote('Make the buttons round')).toBe('')
  })
})

describe('the way a scoped request takes', () => {
  it('is one call, even for a state or a style word', () => {
    for (const message of [
      'Only on the feedback page, buttons should go black on hover',
      'Give just this button a shadow',
      'On phones, make the buttons taller',
    ])
      expect(routeRequest(STYLE_REGISTRY, { message, images: 0 }).mode, message).toBe('single')
  })

  it('leaves the rest as it was', () => {
    expect(
      routeRequest(STYLE_REGISTRY, { message: 'Buttons should go black on hover', images: 0 }).mode
    ).toBe('loop')
  })
})
