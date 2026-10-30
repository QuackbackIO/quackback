/**
 * Every vote box draws its look from one place: the feed card, the post
 * page and similar posts, the widget and the embed card.
 */
import { describe, expect, it } from 'vitest'
import { voteBoxClasses } from '../vote-box'
import { embedVoteBoxClasses } from '../quackback-embed-card'

const classes = (value: string) => value.split(' ')

describe('voteBoxClasses', () => {
  it('draws the idle box with a hover only when it can be used', () => {
    const idle = voteBoxClasses({ voted: false, interactive: true })
    expect(classes(idle.root)).toEqual(
      expect.arrayContaining([
        'w-12',
        'py-2',
        'rounded-md',
        'border',
        'bg-muted/40',
        'hover:bg-muted/60',
      ])
    )
    expect(idle.count).toContain('text-foreground')
    expect(voteBoxClasses({ voted: false, interactive: false }).root).not.toContain('hover:')
  })

  it('draws the voted box in the voted colour, count included', () => {
    const voted = voteBoxClasses({ voted: true, interactive: true })
    expect(classes(voted.root)).toEqual(
      expect.arrayContaining([
        'text-post-card-voted',
        'bg-post-card-voted/15',
        'post-card__vote--voted',
      ])
    )
    expect(voted.root).not.toContain('hover:')
    expect(voted.chevron).toContain('fill-post-card-voted')
    expect(voted.count).toContain('text-post-card-voted')
  })

  it('has compact and pill sizes with the smaller chevron', () => {
    expect(voteBoxClasses({ voted: false, interactive: true, size: 'compact' }).root).toContain(
      'flex-row'
    )
    expect(voteBoxClasses({ voted: false, interactive: true, size: 'pill' }).chevron).toContain(
      'h-3.5'
    )
  })

  it('lifts the chevron on hover only when a vote can be cast', () => {
    expect(voteBoxClasses({ voted: false, interactive: true }).chevron).toContain(
      'group-hover/vote:-translate-y-0.5'
    )
    expect(
      voteBoxClasses({ voted: false, interactive: true, pending: true }).chevron
    ).not.toContain('translate')
    expect(voteBoxClasses({ voted: false, interactive: true, denied: true }).root).toContain(
      'cursor-not-allowed'
    )
  })
})

describe('the embed card’s copy', () => {
  it('draws exactly what voteBoxClasses draws, in every state', () => {
    for (const state of [
      { voted: false, interactive: false },
      { voted: false, interactive: true },
      { voted: true, interactive: true },
      { voted: false, interactive: true, pending: true },
      { voted: true, interactive: true, pending: true },
    ]) {
      expect(embedVoteBoxClasses(state), JSON.stringify(state)).toEqual(voteBoxClasses(state))
    }
  })
})
