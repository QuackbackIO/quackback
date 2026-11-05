import { describe, expect, it } from 'vitest'
import { starPromptStage } from '../github-star-prompt'

const DAY = 24 * 60 * 60 * 1000
const created = new Date('2026-09-01T00:00:00.000Z')
const days = (n: number) => new Date(created.getTime() + n * DAY)

const ready = {
  workspaceCreatedAt: created,
  fifthActiveDayAt: days(10),
  customerInteractions: 20,
}

describe('when the GitHub star prompt may show', () => {
  it('waits until the workspace is three weeks old', () => {
    expect(starPromptStage({ ...ready, now: days(20) })).toBeNull()
    expect(starPromptStage({ ...ready, now: days(21) })).toBe('card')
  })

  it('waits for this person to have been active on five days', () => {
    expect(starPromptStage({ ...ready, fifthActiveDayAt: null, now: days(40) })).toBeNull()
    expect(starPromptStage({ ...ready, fifthActiveDayAt: days(35), now: days(34) })).toBeNull()
    expect(starPromptStage({ ...ready, fifthActiveDayAt: days(35), now: days(35) })).toBe('card')
  })

  it('waits for twenty customer posts, votes or conversations', () => {
    expect(starPromptStage({ ...ready, customerInteractions: 19, now: days(40) })).toBeNull()
  })

  it('needs a known workspace age', () => {
    expect(starPromptStage({ ...ready, workspaceCreatedAt: null, now: days(40) })).toBeNull()
  })

  it('moves to Home once the gates have been open for thirty days', () => {
    // Gates open on day 21 (age), the later of age and the fifth active day.
    expect(starPromptStage({ ...ready, now: days(50) })).toBe('card')
    expect(starPromptStage({ ...ready, now: days(51) })).toBe('home')
    // A late fifth active day opens the gates later.
    expect(starPromptStage({ ...ready, fifthActiveDayAt: days(40), now: days(69) })).toBe('card')
    expect(starPromptStage({ ...ready, fifthActiveDayAt: days(40), now: days(70) })).toBe('home')
  })
})
