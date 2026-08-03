import { describe, it, expect } from 'vitest'
import { matchesBugTrackerKeywords } from '../bug-tracker'

describe('matchesBugTrackerKeywords', () => {
  it('matches a plain keyword', () => {
    expect(matchesBugTrackerKeywords('there is a bug here', ['bug'])).toBe(true)
  })

  it('matches plurals via the leading boundary', () => {
    expect(matchesBugTrackerKeywords('several issues with export', ['issue'])).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(matchesBugTrackerKeywords('BUG in the sidebar', ['bug'])).toBe(true)
  })

  it('does not false-positive inside a longer word', () => {
    expect(matchesBugTrackerKeywords('need to debug this workflow', ['bug'])).toBe(false)
    expect(matchesBugTrackerKeywords('pass me a tissue', ['issue'])).toBe(false)
  })

  it('returns false when no keyword matches', () => {
    expect(matchesBugTrackerKeywords('please add dark mode', ['bug', 'issue'])).toBe(false)
  })

  it('ignores blank keywords', () => {
    expect(matchesBugTrackerKeywords('a bug report', ['', '   '])).toBe(false)
  })

  it('returns false for an empty keyword list', () => {
    expect(matchesBugTrackerKeywords('a bug report', [])).toBe(false)
  })

  it('escapes regex special characters in a keyword', () => {
    expect(matchesBugTrackerKeywords('c++ crashes', ['c++'])).toBe(true)
  })
})
